import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DistanceService } from '../distance/distance.service';
import { ParsedDelivery } from '../upload/upload.service';
import { perf } from '../common/perf';

@Injectable()
export class ProcessingService {
  constructor(
    private databaseService: DatabaseService,
    private distanceService: DistanceService,
  ) {}

  private async measure<T>(
    label: string,
    fn: () => Promise<T>,
    meta?: Record<string, any>,
  ): Promise<T> {
    const t = perf(label);
    try {
      return await fn();
    } finally {
      try {
        t.end(meta);
      } catch {}
    }
  }

  private async withTimeoutFn<T>(
    fn: () => PromiseLike<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let t: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`TIMEOUT_${label}_${ms}ms`)), ms);
    });

    try {
      return await Promise.race([
        Promise.resolve(fn()) as Promise<T>,
        timeoutPromise,
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async processUpload(uploadId: string, deliveries: ParsedDelivery[]) {
    const tTotal = perf('processingService.processUpload.total');
    console.log(`🚀 [PROCESS] START upload=${uploadId} deliveries=${deliveries.length}`);

    try {
      const upload = await this.measure(
        'processingService.upload.fetch',
        () => this.databaseService.getUploadById(uploadId),
        { uploadId },
      );

      if (!upload) throw new Error(`Upload ${uploadId} introuvable`);

      if (upload.status === 'distances_done') {
        console.log(`⚠️ [PROCESS] Upload déjà traité (status=distances_done)`);
        tTotal.end({ uploadId, alreadyDone: true });
        return {
          success: true,
          processed: upload.total_deliveries || 0,
          clients: upload.total_clients || 0,
          message: 'Déjà traité',
        };
      }

      const uploadWarehouseAddress = String(
        (upload as any)?.warehouse_address ??
          (upload as any)?.origin_address ??
          (upload as any)?.address ??
          '',
      ).trim();

      // -------------------------------------------------------------------
      // 1) Group by client (in memory)
      // -------------------------------------------------------------------
      const { clientsMap, clientNames } = await this.measure(
        'processingService.groupByClient',
        async () => {
          const map = new Map<string, any>();

          for (const delivery of deliveries) {
            const clientName = (delivery.clientName || '').trim() || 'Client inconnu';
            const fullAddress = this.buildFullAddress(delivery);

            if (!map.has(clientName)) {
              map.set(clientName, {
                name: clientName,
                address: fullAddress,
                postal_code: (delivery as any).postalCode,
                city: (delivery as any).city,
                country: (delivery as any).country,
                deliveries: [],
              });
            }

            map.get(clientName).deliveries.push({
              ...delivery,
              destination_address: fullAddress,
            });
          }

          return { clientsMap: map, clientNames: Array.from(map.keys()) };
        },
        { deliveries: deliveries.length },
      );

      console.log(`👥 [PROCESS] ${clientsMap.size} clients détectés`);

      // -------------------------------------------------------------------
      // 2) UPSERT clients batch (requires UNIQUE(upload_id, name))
      // -------------------------------------------------------------------
      await this.measure(
        'processingService.db.clients.upsert_batch',
        () =>
          this.databaseService.upsertClientsBatch(
            uploadId,
            clientNames.map((name) => {
              const c = clientsMap.get(name);
              return {
                upload_id: uploadId,
                name,
                address: c.address,
                postal_code: c.postal_code,
                city: c.city,
                country: c.country,
                total_deliveries: 0,
                total_amount_ht: 0,
                total_amount_ttc: 0,
              };
            }),
          ),
        { uploadId, clients: clientNames.length },
      );

      // -------------------------------------------------------------------
      // 3) Fetch all client ids in one call
      // -------------------------------------------------------------------
      const clientsRows = await this.measure(
        'processingService.db.clients.fetch_ids',
        () => this.databaseService.getClientsBasicByUpload(uploadId),
        { uploadId },
      );

      const clientIdByName = new Map<string, string>();
      for (const c of clientsRows) {
        clientIdByName.set(String(c.name), String(c.id));
      }

      // -------------------------------------------------------------------
      // 4) Compute distances + prepare deliveries rows (DB write later in batch)
      // -------------------------------------------------------------------
      const deliveriesRowsToInsert: any[] = [];
      const successfulByClientId = new Map<string, number>();

      await this.measure(
        'processingService.deliveries.prepare_all',
        async () => {
          for (const [clientName, clientData] of clientsMap) {
            const clientId = clientIdByName.get(clientName);
            if (!clientId) throw new Error(`Client id introuvable: "${clientName}"`);

            for (const delivery of clientData.deliveries) {
              let distanceKm: number | null = null;
              let deliveryStatus = delivery.status;

              const originAddress = String(
                delivery.warehouseAddress || uploadWarehouseAddress || delivery.warehouse || '',
              ).trim();

              const destinationAddress = String(delivery.destination_address || '').trim();

              if (!originAddress || !destinationAddress) {
                deliveryStatus = 'ADDRESS_NOT_FOUND';
                distanceKm = null;
              } else {
                try {
                  const result = await (this.distanceService as any).getRouteDistanceKm(
                    originAddress,
                    destinationAddress,
                  );

                  const km = Number(result?.km ?? NaN);
                  const fromCache = Boolean(result?.fromCache);

                  if (!Number.isFinite(km) || km <= 0) {
                    deliveryStatus = 'ADDRESS_NOT_FOUND';
                    distanceKm = null;
                  } else {
                    distanceKm = km;
                    deliveryStatus = 'DISTANCE_OK';
                    const cur = successfulByClientId.get(clientId) ?? 0;
                    successfulByClientId.set(clientId, cur + 1);
                  }

                  if (!fromCache) await this.delay(200);
                } catch {
                  distanceKm = null;
                  deliveryStatus = 'CALCULATION_ERROR';
                }
              }

              const taskId = String(delivery.taskId ?? '').trim();
              const serviceType = String(delivery.type ?? '').trim();

              deliveriesRowsToInsert.push({
                upload_id: uploadId,
                client_id: clientId,
                task_id: taskId || null,
                service_type: serviceType || null,
                delivery_date: this.parseDate(delivery.date),
                origin_warehouse: delivery.warehouse,
                origin_address: originAddress || null,
                destination_address: destinationAddress || null,
                distance_km: distanceKm,
                price_ht: 0,
                price_ttc: 0,
                status: deliveryStatus,
              });
            }
          }
        },
        { uploadId, rows: deliveriesRowsToInsert.length },
      );
      await this.measure(
  'processingService.db.deliveries.cleanup_upload',
  () => this.databaseService.deleteDeliveriesByUpload(uploadId),
  { uploadId },
);


      // -------------------------------------------------------------------
      // 5) Insert deliveries in batch (chunks)
      // -------------------------------------------------------------------
      await this.measure(
        'processingService.db.deliveries.insert_batch',
        async () => {
          const chunks = this.chunkArray(deliveriesRowsToInsert, 200);
          for (const chunk of chunks) {
            await this.databaseService.createDeliveriesBatch(chunk);
          }
        },
        { uploadId, rows: deliveriesRowsToInsert.length },
      );

      // -------------------------------------------------------------------
      // 6) Update client totals in batch (keeps old behavior)
      // -------------------------------------------------------------------
      await this.measure(
        'processingService.db.clients.update_totals_batch',
        async () => {
          const updates = Array.from(successfulByClientId.entries()).map(([clientId, okCount]) => ({
            id: clientId,
            total_deliveries: okCount,
            total_amount_ht: 0,
            total_amount_ttc: 0,
          }));

          if (updates.length > 0) {
            await this.databaseService.updateClientsTotalsBatch(updates);
          }
        },
        { uploadId, clientsUpdated: successfulByClientId.size },
      );

      // -------------------------------------------------------------------
      // 7) Update upload done
      // -------------------------------------------------------------------
      const processedCount = deliveriesRowsToInsert.length;
      const totalClients = clientNames.length;

      await this.measure(
        'processingService.db.updateUploadDone',
        () =>
          this.withTimeoutFn(
            () =>
              this.databaseService.updateUpload(uploadId, {
                status: 'distances_done',
                total_deliveries: processedCount,
                total_clients: totalClients,
                total_amount: 0,
              }) as unknown as PromiseLike<any>,
            20000,
            'UPDATE_UPLOAD_DONE',
          ),
        { uploadId, processedCount, totalClients },
      );

      console.log(`🎉 [PROCESS] ✅ TERMINÉ avec succès !`);
      tTotal.end({ uploadId, processedCount, totalClients });

      return { success: true, processed: processedCount, clients: totalClients };
    } catch (error: any) {
      console.error(`💥 [PROCESS] ❌ ÉCHEC upload=${uploadId}`, error?.message || error);

      try {
        await this.withTimeoutFn(
          () =>
            this.databaseService.updateUpload(uploadId, { status: 'failed' }) as unknown as PromiseLike<any>,
          20000,
          'UPDATE_UPLOAD_FAILED',
        );
      } catch {}

      try {
        tTotal.end({ uploadId, failed: true });
      } catch {}

      throw error;
    }
  }

  private buildFullAddress(delivery: ParsedDelivery): string {
    const rawNumber = (delivery as any).number ?? '';
    const numberStr = String(rawNumber).trim().replace(/\.0$/, '');

    const rawCountry = String((delivery as any).country ?? '').trim();
    const countryUpper = rawCountry.toUpperCase();
    const country = countryUpper === 'FRA' ? 'France' : rawCountry;

    const street = String((delivery as any).street ?? '').trim();
    const postalCode = String((delivery as any).postalCode ?? '').trim();
    const city = String((delivery as any).city ?? '').trim();

    const parts = [
      [numberStr, street].filter(Boolean).join(' ').trim(),
      [postalCode, city].filter(Boolean).join(' ').trim(),
      country,
    ]
      .map((p) => (p ?? '').toString().trim())
      .filter((p) => p.length > 0);

    const joined = parts.join(', ');
    if (!country && joined) return `${joined}, France`;
    return joined;
  }

  private parseDate(dateStr?: string | null): string | null {
    if (!dateStr) return null;
    const parts = String(dateStr).split('/');
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const yyyy = parts[2];
      return `${yyyy}-${mm}-${dd}`;
    }
    return String(dateStr);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
