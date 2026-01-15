import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { perf } from '../common/perf';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';
import { UploadService } from './upload.service';
import { DatabaseService } from '../database/database.service';
import { ProcessingService } from '../processing/processing.service';
import { AddressValidatorService } from './address-validator.service';

const processingLocks = new Set<string>();

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly databaseService: DatabaseService,
    private readonly processingService: ProcessingService,
    private readonly addressValidator: AddressValidatorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Auth helpers
  // ---------------------------------------------------------------------------
  private extractBearerToken(req: Request): string | null {
    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2) return null;
    if (parts[0].toLowerCase() !== 'bearer') return null;

    return parts[1].trim();
  }

  private async getSupabaseUserFromRequest(req: Request) {
    const token = this.extractBearerToken(req);
    if (!token) {
      throw new ForbiddenException(
        'Non authentifié (token manquant). Veuillez vous reconnecter.',
      );
    }

    const { data, error } = await this.databaseService
      .getPublicClient()
      .auth.getUser(token);

    if (error || !data?.user) {
      throw new ForbiddenException(
        'Session invalide ou expirée. Veuillez vous reconnecter.',
      );
    }

    return data.user;
  }
  private async consumeCreditsOrFail(userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;

  // lecture credits
  const { data: profile, error: readErr } = await this.databaseService
    .getClient()
    .from('profiles')
    .select('id, credits_remaining')
    .eq('id', userId)
    .single();

  if (readErr) throw readErr;
  if (!profile) {
    throw new ForbiddenException('Profil utilisateur introuvable (credits).');
  }

  const current = Number(profile.credits_remaining ?? 0);

  if (current < amount) {
    throw new ForbiddenException(
      `Crédits insuffisants. Requis: ${amount}, disponibles: ${current}.`,
    );
  }

  // update optimiste (évite race conditions)
  const attemptUpdate = async (expectedCurrent: number) => {
    const { data, error } = await this.databaseService
      .getClient()
      .from('profiles')
      .update({ credits_remaining: expectedCurrent - amount })
      .eq('id', userId)
      .eq('credits_remaining', expectedCurrent)
      .select('id, credits_remaining');

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  };

  let updated = await attemptUpdate(current);
  if (updated) return;

  // retry (quelqu’un a modifié credits entre temps)
  const { data: profile2, error: readErr2 } = await this.databaseService
    .getClient()
    .from('profiles')
    .select('id, credits_remaining')
    .eq('id', userId)
    .single();

  if (readErr2) throw readErr2;

  const current2 = Number(profile2?.credits_remaining ?? 0);
  if (current2 < amount) {
    throw new ForbiddenException(
      `Crédits insuffisants. Requis: ${amount}, disponibles: ${current2}.`,
    );
  }

  updated = await attemptUpdate(current2);
  if (!updated) {
    throw new BadRequestException(
      'Impossible de consommer les crédits (concurrence). Réessayez.',
    );
  }
}


  // ---------------------------------------------------------------------------
  // Upload file
  // ---------------------------------------------------------------------------
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads', // temporaire uniquement
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const allowedExtensions = ['.xlsx', '.xls', '.csv'];

        if (allowedExtensions.includes(ext)) cb(null, true);
        else {
          cb(
            new BadRequestException(
              'Format non supporté. Utilisez .xlsx, .xls ou .csv',
            ),
            false,
          );
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');

    // 🔐 upload obligatoirement authentifié
    const user = await this.getSupabaseUserFromRequest(req);
    const userId = user.id;

    console.log(`📁 Fichier reçu: ${file.originalname}`);
    const tAll = perf(`uploadFile all | file=${file.originalname}`);

    try {
      // ----------------------------------------------------
      // 1) Parse fichier (local, temporaire)
      // ----------------------------------------------------
      const tParse = perf('parse file');

      let deliveries;
      const ext = extname(file.originalname).toLowerCase();
      if (ext === '.csv') {
        deliveries = this.uploadService.parseCSVFile(file.path);
      } else {
        deliveries = this.uploadService.parseExcelFile(file.path);
      }

      tParse.end({ rows: deliveries.length });

      // ----------------------------------------------------
      // 2) Create upload (DB)
      // ----------------------------------------------------
      const tCreateUpload = perf('db createUpload');

      const upload = await this.databaseService.createUpload({
        filename: file.originalname,
        user_id: userId,
      });

      tCreateUpload.end({ uploadId: upload.id });
      console.log(`✅ Upload créé: ${upload.id}`);

      // ----------------------------------------------------
      // 3) Upload fichier vers Supabase Storage ✅
      // ----------------------------------------------------
      const tStorage = perf('storage upload');

      const storageInfo =
        await this.databaseService.uploadLocalFileToStorage({
          localPath: file.path,
          originalName: file.originalname,
          userId,
          uploadId: upload.id,
        });

      await this.databaseService.updateUpload(upload.id, {
        storage_bucket: storageInfo.bucket,
        storage_path: storageInfo.storage_path,
      });

      tStorage.end(storageInfo);

      // ----------------------------------------------------
      // 4) Validation + batch insert pending_deliveries
      // ----------------------------------------------------
      let validCount = 0;
      let invalidCount = 0;

      const rowsToInsert = deliveries.map((delivery) => {
        const validation = this.addressValidator.validateAddress(
          delivery.number,
          delivery.street,
          delivery.postalCode,
          delivery.city,
          delivery.country,
        );

        if (validation.isValid) validCount++;
        else invalidCount++;

        return {
          upload_id: upload.id,
          client_name: delivery.clientName,
          original_number: delivery.number,
          original_street: delivery.street,
          original_postal_code: delivery.postalCode,
          original_city: delivery.city,
          original_country: delivery.country,
          full_address: validation.cleanedAddress,
          issues: JSON.stringify(validation.issues),
          is_valid: validation.isValid,
          delivery_date: delivery.date,
          warehouse: delivery.warehouse,
          warehouse_address: delivery.warehouseAddress,
          driver: delivery.driver,
          task_id: delivery.taskId,
          status: delivery.status,
        };
      });

      const tPending = perf('db insert pending_deliveries (batch)');
      await this.databaseService.createPendingDeliveriesBatch(rowsToInsert, 200);
      tPending.end({ inserted: rowsToInsert.length });

      // ----------------------------------------------------
      // 5) Update upload status
      // ----------------------------------------------------
      const tUpdateUpload = perf('db updateUpload');

      await this.databaseService.updateUpload(upload.id, {
        status: invalidCount > 0 ? 'pending_validation' : 'ready',
        total_deliveries: deliveries.length,
      });

      tUpdateUpload.end();
      tAll.end({
        uploadId: upload.id,
        total: deliveries.length,
        invalid: invalidCount,
      });

      return {
        success: true,
        upload_id: upload.id,
        stats: {
          total_deliveries: deliveries.length,
          valid_count: validCount,
          invalid_count: invalidCount,
        },
        needs_validation: invalidCount > 0,
        message:
          invalidCount > 0
            ? `${invalidCount} adresses nécessitent une correction`
            : 'Toutes les adresses sont valides',
      };
    } catch (error: any) {
      console.error('❌ Erreur upload:', error);
      throw new BadRequestException(
        `Erreur lors du traitement: ${error.message}`,
      );
    }
  }
  @Get('my-uploads')
  async getMyUploads(@Req() req: Request) {
    const user = await this.getSupabaseUserFromRequest(req);
    const userId = user.id;

    const { data, error } = await this.databaseService
      .getClient()
      .from('uploads')
      .select(
        'id, filename, status, total_deliveries, total_clients, total_amount, created_at, storage_bucket, storage_path',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      success: true,
      uploads: data ?? [],
    };
  }

  @Get(':id/invalid-addresses')
  async getInvalidAddresses(@Param('id') uploadId: string) {
    try {
      const invalidDeliveries =
        await this.databaseService.getInvalidDeliveriesByUpload(uploadId);

      return {
        success: true,
        upload_id: uploadId,
        invalid_count: invalidDeliveries.length,
        addresses: invalidDeliveries.map((d) => ({
          ...d,
          issues: typeof d.issues === 'string' ? JSON.parse(d.issues) : d.issues,
        })),
      };
    } catch (error: any) {
      throw new BadRequestException(`Erreur récupération adresses: ${error.message}`);
    }
  }

  @Patch(':id/fix-address/:addressId')
  async fixAddress(
    @Param('id') uploadId: string,
    @Param('addressId') addressId: string,
    @Body()
    correction: {
      number: string;
      street: string;
      postalCode: string;
      city: string;
      country: string;
    },
  ) {
    try {
      const validation = this.addressValidator.validateAddress(
        correction.number,
        correction.street,
        correction.postalCode,
        correction.city,
        correction.country,
      );

      if (!validation.isValid) {
        return {
          success: false,
          message: 'Adresse corrigée toujours invalide',
          issues: validation.issues,
        };
      }

      await this.databaseService.updatePendingDelivery(addressId, {
        corrected_number: correction.number,
        corrected_street: correction.street,
        corrected_postal_code: correction.postalCode,
        corrected_city: correction.city,
        corrected_country: correction.country,
        full_address: validation.cleanedAddress,
        is_valid: true,
        issues: JSON.stringify([]),
      });

      const remaining = await this.databaseService.getInvalidDeliveriesByUpload(uploadId);

      return {
        success: true,
        message: 'Adresse corrigée',
        remaining_invalid: remaining.length,
        all_valid: remaining.length === 0,
      };
    } catch (error: any) {
      throw new BadRequestException(`Erreur correction adresse: ${error.message}`);
    }
  }

  @Post(':id/process')
  async processUpload(@Param('id') uploadId: string, @Req() req: Request) {
    console.log(`🎯 POST /upload/${uploadId}/process - Début`);

    // ✅ Requis pour consommer des crédits et sécuriser l'accès
    const user = await this.getSupabaseUserFromRequest(req);
    const userId = user.id;

    if (processingLocks.has(uploadId)) {
      return { success: true, message: 'Le traitement est déjà en cours', upload_id: uploadId };
    }

    processingLocks.add(uploadId);

    const watchdogMs = 10 * 60 * 1000;
    let watchdog: NodeJS.Timeout | null = setTimeout(async () => {
      console.error(`⏱️ WATCHDOG: upload ${uploadId} bloqué -> status=failed`);
      try {
        await this.databaseService.updateUpload(uploadId, { status: 'failed' });
      } catch (e) {
        console.error('❌ WATCHDOG update failed impossible:', e);
      } finally {
        processingLocks.delete(uploadId);
      }
    }, watchdogMs);

    try {
      // ✅ check ownership: l'upload doit appartenir à l'utilisateur
      const { data: uploadRow, error: uploadErr } = await this.databaseService
        .getClient()
        .from('uploads')
        .select('id, status, user_id')
        .eq('id', uploadId)
        .single();

      if (uploadErr) throw uploadErr;

      if (!uploadRow || uploadRow.user_id !== userId) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      const currentStatus = uploadRow.status;

      if (currentStatus === 'processing') {
        return { success: true, message: 'Le traitement est déjà en cours', upload_id: uploadId };
      }

      if (currentStatus === 'distances_done') {
        return { success: true, message: 'Le traitement a déjà été effectué', upload_id: uploadId };
      }

      await this.databaseService.updateUpload(uploadId, { status: 'processing' });

      const invalidDeliveries = await this.databaseService.getInvalidDeliveriesByUpload(uploadId);
      if (invalidDeliveries.length > 0) {
        await this.databaseService.updateUpload(uploadId, { status: 'pending_validation' });

        return {
          success: false,
          message: `${invalidDeliveries.length} adresses invalides restantes`,
          invalid_count: invalidDeliveries.length,
        };
      }

      const validDeliveries = await this.databaseService.getPendingDeliveriesByUpload(uploadId);

      const deliveriesToProcess = validDeliveries.map((d) => ({
        clientName: d.client_name,
        number: d.corrected_number || d.original_number,
        street: d.corrected_street || d.original_street,
        postalCode: d.corrected_postal_code || d.original_postal_code,
        city: d.corrected_city || d.original_city,
        country: d.corrected_country || d.original_country,
        date: d.delivery_date,
        warehouse: d.warehouse,
        warehouseAddress: d.warehouse_address,
        driver: d.driver,
        taskId: d.task_id,
        status: d.status,
      }));

      try {
        await this.consumeCreditsOrFail(userId, deliveriesToProcess.length);
      } catch (creditErr: any) {
        await this.databaseService.updateUpload(uploadId, { status: 'ready' });

        if (creditErr instanceof ForbiddenException) throw creditErr;
        throw new BadRequestException(creditErr?.message || 'Erreur consommation crédits');
      }

      (async () => {
        try {
          console.log(`🚀 Lancement ProcessingService upload=${uploadId}`);
          await this.processingService.processUpload(uploadId, deliveriesToProcess as any);

          console.log(`🧹 Suppression pending_deliveries upload=${uploadId}`);
          await this.databaseService.deletePendingDeliveriesByUpload(uploadId);

          console.log(`✅ Traitement terminé upload=${uploadId}`);
        } catch (error) {
          console.error(`❌ Erreur traitement:`, error);
          try {
            await this.databaseService.updateUpload(uploadId, { status: 'failed' });
          } catch (e) {
            console.error('❌ Impossible update status failed:', e);
          }
        } finally {
          if (watchdog) clearTimeout(watchdog);
          watchdog = null;
          processingLocks.delete(uploadId);
        }
      })();

      return {
        success: true,
        message: 'Traitement lancé',
        upload_id: uploadId,
        total_deliveries: deliveriesToProcess.length,
      };
    } catch (error: any) {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      processingLocks.delete(uploadId);

      if (error instanceof ForbiddenException) throw error;

      throw new BadRequestException(`Erreur lancement traitement: ${error.message}`);
    }
  }

  @Get(':id/status')
  async getUploadStatus(@Param('id') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getSupabaseUserFromRequest(req);

      const upload = await this.databaseService
        .getClient()
        .from('uploads')
        .select('*')
        .eq('id', uploadId)
        .single();

      if (upload.error) throw upload.error;

      if (!upload.data || upload.data.user_id !== user.id) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      return { success: true, upload: upload.data };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(`Erreur récupération status: ${error.message}`);
    }
  }

  @Get(':id/clients')
  async getClientsByUpload(@Param('id') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getSupabaseUserFromRequest(req);

      // ownership check
      const { data: up, error: upErr } = await this.databaseService
        .getClient()
        .from('uploads')
        .select('id, user_id')
        .eq('id', uploadId)
        .single();

      if (upErr) throw upErr;
      if (!up || up.user_id !== user.id) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      // 1) récupérer les clients (sans se fier aux totaux stockés)
      const { data: clients, error: cErr } = await this.databaseService
        .getClient()
        .from('clients')
        .select('id, name, address, postal_code, city, country')
        .eq('upload_id', uploadId)
        .order('name', { ascending: true });

      if (cErr) throw cErr;

      const clientList = (clients ?? []) as any[];

      // 2) récupérer toutes les deliveries de l’upload (prix déjà calculés)
      const { data: deliveries, error: dErr } = await this.databaseService
        .getClient()
        .from('deliveries')
        .select('id, client_id, price_ht, price_ttc')
        .eq('upload_id', uploadId);

      if (dErr) throw dErr;

      const deliveryList = (deliveries ?? []) as Array<{
        id: string;
        client_id: string;
        price_ht: number | null;
        price_ttc: number | null;
      }>;

      // 3) agrégation en mémoire
      const agg = new Map<
        string,
        { total_deliveries: number; total_amount_ht: number; total_amount_ttc: number }
      >();

      for (const d of deliveryList) {
        const key = d.client_id;
        const cur = agg.get(key) ?? {
          total_deliveries: 0,
          total_amount_ht: 0,
          total_amount_ttc: 0,
        };

        cur.total_deliveries += 1;
        cur.total_amount_ht += Number(d.price_ht ?? 0);
        cur.total_amount_ttc += Number(d.price_ttc ?? 0);

        agg.set(key, cur);
      }

      // 4) merge client + totaux
      const result = clientList.map((c) => {
        const a = agg.get(c.id) ?? {
          total_deliveries: 0,
          total_amount_ht: 0,
          total_amount_ttc: 0,
        };

        const round2 = (n: number) => Math.round(n * 100) / 100;

        return {
          id: c.id,
          name: c.name,
          address: c.address,
          postal_code: c.postal_code,
          city: c.city,
          country: c.country,
          total_deliveries: a.total_deliveries,
          total_amount_ht: round2(a.total_amount_ht),
          total_amount_ttc: round2(a.total_amount_ttc),
        };
      });

      return {
        success: true,
        upload_id: uploadId,
        total_clients: result.length,
        clients: result,
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(
        `Erreur récupération clients: ${error?.message || error}`,
      );
    }
  }

  @Get(':id/deliveries')
  async getDeliveriesByUpload(@Param('id') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getSupabaseUserFromRequest(req);

      // ownership check
      const { data: up, error: upErr } = await this.databaseService
        .getClient()
        .from('uploads')
        .select('id, user_id')
        .eq('id', uploadId)
        .single();

      if (upErr) throw upErr;
      if (!up || up.user_id !== user.id) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      console.log(`📦 [DELIVERIES] Requête deliveries pour upload=${uploadId}`);

      const clients = await this.databaseService.getClientsByUpload(uploadId);

      const allDeliveries: any[] = [];

      for (const client of clients) {
        const deliveries = await this.databaseService.getDeliveriesByClient(client.id);

        const enrichedDeliveries = deliveries.map((d) => ({
          ...d,
          client_name: client.name,
        }));

        allDeliveries.push(...enrichedDeliveries);
      }

      console.log(`✅ [DELIVERIES] ${allDeliveries.length} livraisons trouvées`);

      return {
        success: true,
        upload_id: uploadId,
        total_deliveries: allDeliveries.length,
        deliveries: allDeliveries,
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      console.error(`❌ [DELIVERIES] Erreur:`, error);
      throw new BadRequestException(error?.message || 'Erreur récupération livraisons');
    }
  }

  // ✅ PRICING ROUTES

  @Post(':id/pricing-config')
  async savePricingConfig(
    @Param('id') uploadId: string,
    @Body() body: { tiers: any[] },
    @Req() req: Request,
  ) {
    try {
      const user = await this.getSupabaseUserFromRequest(req);

      // ownership check
      const { data: up, error: upErr } = await this.databaseService
        .getClient()
        .from('uploads')
        .select('id, user_id')
        .eq('id', uploadId)
        .single();

      if (upErr) throw upErr;
      if (!up || up.user_id !== user.id) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      console.log(`💰 [PRICING-CONFIG] Save pour upload=${uploadId}`);

      await this.databaseService.updateUpload(uploadId, {
        pricing_tiers: body.tiers,
      });

      console.log(`✅ [PRICING-CONFIG] Tarification enregistrée`);

      return {
        success: true,
        message: 'Configuration de tarification enregistrée',
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      console.error(`❌ [PRICING-CONFIG] Erreur:`, error);
      throw new BadRequestException(
        error?.message || 'Erreur enregistrement tarification',
      );
    }
  }

  @Post(':id/apply-pricing')
  async applyPricing(@Param('id') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getSupabaseUserFromRequest(req);

      // ownership check
      const { data: up, error: upErr } = await this.databaseService
        .getClient()
        .from('uploads')
        .select('id, user_id')
        .eq('id', uploadId)
        .single();

      if (upErr) throw upErr;
      if (!up || up.user_id !== user.id) {
        throw new ForbiddenException('Accès refusé à cet upload');
      }

      console.log(`💰 [APPLY-PRICING] Début pour upload=${uploadId}`);

      const upload = await this.databaseService.getUploadById(uploadId);
      const tiers = upload.pricing_tiers;

      if (!tiers || !Array.isArray(tiers)) {
        throw new BadRequestException('Configuration de tarification manquante');
      }

      const clients = await this.databaseService.getClientsByUpload(uploadId);

      let totalAmountHT = 0;
      let totalAmountTTC = 0;

      for (const client of clients) {
        const deliveries = await this.databaseService.getDeliveriesByClient(client.id);

        let clientHT = 0;
        let clientTTC = 0;

        for (const delivery of deliveries) {
          if (!delivery.distance_km) continue;

          const price = this.calculatePrice(delivery.distance_km, tiers);

          if (price) {
            await this.databaseService
              .getClient()
              .from('deliveries')
              .update({
                price_ht: price.ht,
                price_ttc: price.ttc,
              })
              .eq('id', delivery.id);

            clientHT += price.ht;
            clientTTC += price.ttc;
          }
        }

        await this.databaseService.updateClient(client.id, {
          total_amount_ht: Math.round(clientHT * 100) / 100,
          total_amount_ttc: Math.round(clientTTC * 100) / 100,
        });

        totalAmountHT += clientHT;
        totalAmountTTC += clientTTC;
      }

      await this.databaseService.updateUpload(uploadId, {
        total_amount: Math.round(totalAmountTTC * 100) / 100,
      });

      console.log(
        `✅ [APPLY-PRICING] Terminé - Total TTC: ${totalAmountTTC.toFixed(2)} €`,
      );

      return {
        success: true,
        message: 'Tarification appliquée avec succès',
        total_ht: Math.round(totalAmountHT * 100) / 100,
        total_ttc: Math.round(totalAmountTTC * 100) / 100,
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      console.error(`❌ [APPLY-PRICING] Erreur:`, error);
      throw new BadRequestException(
        error?.message || 'Erreur application tarification',
      );
    }
  }

  private calculatePrice(distanceKm: number, tiers: any[]) {
    const sortedTiers = [...tiers].sort((a, b) => a.range_start - b.range_start);

    for (const tier of sortedTiers) {
      const inRange =
        distanceKm >= tier.range_start &&
        (tier.range_end === null || distanceKm < tier.range_end);

      if (inRange) {
        const ht = tier.price;
        const tva = (ht * tier.tva_rate) / 100;
        const ttc = ht + tva;

        return {
          ht: Math.round(ht * 100) / 100,
          ttc: Math.round(ttc * 100) / 100,
          tva: Math.round(tva * 100) / 100,
        };
      }
    }

    return null;
  }
}
