import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  Req,
  ForbiddenException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { InvoiceService } from './invoice.service';

@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly db: DatabaseService,
    private readonly invoiceService: InvoiceService,
  ) {}

  private extractBearerToken(req: Request): string | null {
    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2) return null;
    if (parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1].trim();
  }

  private async getUser(req: Request) {
    const token = this.extractBearerToken(req);
    if (!token) {
      throw new ForbiddenException(
        'Non authentifié (token manquant). Veuillez vous reconnecter.',
      );
    }

    const { data, error } = await this.db.getClient().auth.getUser(token);

    if (error || !data?.user) {
      throw new ForbiddenException(
        'Session invalide ou expirée. Veuillez vous reconnecter.',
      );
    }
    return data.user;
  }

  private async assertUploadOwnedByUser(uploadId: string, userId: string) {
    const { data: up, error: upErr } = await this.db
      .getClient()
      .from('uploads')
      .select('id, user_id')
      .eq('id', uploadId)
      .single();

    if (upErr) throw upErr;

    if (!up || up.user_id !== userId) {
      throw new ForbiddenException('Accès refusé à cet upload');
    }
  }

  @Get(':uploadId/overview')
  async overview(@Param('uploadId') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const data = await this.invoiceService.getUploadOverview(uploadId);
      return { success: true, ...data };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur overview');
    }
  }

  @Get(':uploadId/clients')
  async clients(@Param('uploadId') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const data = await this.invoiceService.getUploadOverview(uploadId);
      return { success: true, clients: data.clients, totals: data.totals };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur clients');
    }
  }

  // ✅ ZIP : 1 PDF par client (company_name en query)
  @Get(':uploadId/zip')
  async downloadZip(
    @Param('uploadId') uploadId: string,
    @Query('company_name') companyNameQ: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const companyName = String(companyNameQ ?? '').trim() || null;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="factures_${uploadId}.zip"`,
      );

      await this.invoiceService.streamInvoicesZip(uploadId, res, companyName);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur génération ZIP');
    }
  }

  @Post(':uploadId/global')
  async downloadGlobalInvoice(
    @Param('uploadId') uploadId: string,
    @Body()
    body: {
      company_name?: string;
      global_client_name?: string;

      company_address?: string;
      invoice_date?: string;
      payment_method?: string;
      payment_due_date?: string;
      service_date?: string;
      client_address?: string;
      rib_iban?: string;
      bic?: string;
      company_siren?: string;
      company_vat?: string;
    },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const companyName = String(body?.company_name ?? '').trim();
      const globalClientName = String(body?.global_client_name ?? '').trim();

      if (!companyName) {
        throw new BadRequestException("Le champ 'company_name' est requis.");
      }
      if (!globalClientName) {
        throw new BadRequestException("Le champ 'global_client_name' est requis.");
      }

      // ✅ meta (on ne casse pas la logique : tout est optionnel)
      const meta = {
        companyAddress: String(body?.company_address ?? '').trim() || undefined,
        invoiceDate: String(body?.invoice_date ?? '').trim() || undefined,
        paymentMethod: String(body?.payment_method ?? '').trim() || undefined,
        paymentDueDate: String(body?.payment_due_date ?? '').trim() || undefined,
        serviceDate: String(body?.service_date ?? '').trim() || undefined,
        clientAddress: String(body?.client_address ?? '').trim() || undefined,
        ribIban: String(body?.rib_iban ?? '').trim() || undefined,
        bic: String(body?.bic ?? '').trim() || undefined,
        companySiren: String(body?.company_siren ?? '').trim() || undefined,
        companyVat: String(body?.company_vat ?? '').trim() || undefined,
      };

      const pdf = await this.invoiceService.generateGlobalInvoicePdf(
        uploadId,
        companyName,
        globalClientName,
        meta,
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="facture_globale_${uploadId}.pdf"`,
      );

      res.end(pdf);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(
        err?.message || 'Erreur génération facture globale',
      );
    }
  }

  @Post(':uploadId/:clientId/pdf')
  async downloadInvoiceWithCompany(
    @Param('uploadId') uploadId: string,
    @Param('clientId') clientId: string,
    @Body() body: { company_name?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const companyName = String(body?.company_name ?? '').trim();
      if (!companyName) {
        throw new BadRequestException("Le champ 'company_name' est requis.");
      }

      const pdf = await this.invoiceService.generateClientInvoicePdfWithCompany(
        uploadId,
        clientId,
        companyName,
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="facture_${clientId}.pdf"`,
      );

      res.end(pdf);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur génération PDF');
    }
  }

  // ✅ GET client (company_name en query)
  @Get(':uploadId/:clientId')
  async downloadInvoice(
    @Param('uploadId') uploadId: string,
    @Param('clientId') clientId: string,
    @Query('company_name') companyNameQ: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const companyName = String(companyNameQ ?? '').trim();

      const pdf = companyName
        ? await this.invoiceService.generateClientInvoicePdfWithCompany(
            uploadId,
            clientId,
            companyName,
          )
        : await this.invoiceService.generateClientInvoicePdf(uploadId, clientId);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="facture_${clientId}.pdf"`,
      );

      res.end(pdf);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur génération PDF');
    }
  }
}
