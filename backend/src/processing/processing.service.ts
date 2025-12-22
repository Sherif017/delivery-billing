import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DistanceService } from '../distance/distance.service';
import { ParsedDelivery } from '../upload/upload.service';

@Injectable()
export class ProcessingService {
  constructor(
    private databaseService: DatabaseService,
    private distanceService: DistanceService,
  ) {}

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
      return await Promise.race([Promise.resolve(fn()) as Promise<T>, timeoutPromise]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async processUpload(uploadId: string, deliveries: ParsedDelivery[]) {
    console.log(`🚀 [PROCESS] START upload=${uploadId} deliveries=${deliveries.length}`);

    try {
      // ✅ 0) Vérifier que l'upload existe et est en status processing
      console.log(`🔍 [PROCESS] Vérification de l'upload...`);
      const upload = await this.databaseService.getUploadById(uploadId);
      
      if (!upload) {
        throw new Error(`Upload ${uploadId} introuvable`);
      }

      if (upload.status === 'distances_done') {
        console.log(`⚠️ [PROCESS] Upload déjà traité (status=distances_done)`);
        return { 
          success: true, 
          processed: upload.total_deliveries || 0, 
          clients: upload.total_clients || 0,
          message: 'Déjà traité'
        };
      }

      // 1) Group by client
      console.log(`🧩 [PROCESS] Groupement par client...`);
      const clientsMap = new Map<string, any>();

      deliveries.forEach((delivery) => {
        const clientName = (delivery.clientName || '').trim();
        const fullAddress = this.buildFullAddress(delivery);

        if (!clientsMap.has(clientName)) {
          clientsMap.set(clientName, {
            name: clientName,
            address: fullAddress,
            postal_code: delivery.postalCode,
            city: delivery.city,
            country: delivery.country,
            deliveries: [],
          });
        }

        clientsMap.get(clientName).deliveries.push({
          ...delivery,
          destination_address: fullAddress,
        });
      });

      console.log(`👥 [PROCESS] ${clientsMap.size} clients détectés`);
      for (const [clientName, clientData] of clientsMap) {
        console.log(`   - "${clientName}" => ${clientData.deliveries.length} livraison(s)`);
      }

      let processedCount = 0;
      let totalClients = 0;

      // 2) For each client
      for (const [clientName, clientData] of clientsMap) {
        console.log(`\n📦 [PROCESS] Traitement client="${clientName}" (${clientData.deliveries.length} livraisons)`);

        // 2.1) find / create client
        console.log(`🔎 [PROCESS] Recherche du client...`);
        let client = await this.findClientByName(uploadId, clientName);

        if (client) {
          console.log(`✅ [PROCESS] Client existant id=${client.id}`);
        } else {
          console.log(`➕ [PROCESS] Création du client...`);
          client = await this.withTimeoutFn(
            () =>
              this.databaseService.createClient({
                upload_id: uploadId,
                name: clientName,
                address: clientData.address,
                postal_code: clientData.postal_code,
                city: clientData.city,
                country: clientData.country,
                total_deliveries: 0,
                total_amount_ht: 0,
                total_amount_ttc: 0,
              }) as unknown as PromiseLike<any>,
            20000,
            'CREATE_CLIENT',
          );
          console.log(`✅ [PROCESS] Client créé id=${client.id}`);
        }

        let successfulDeliveries = 0;

        // 2.2) each delivery
        for (let i = 0; i < clientData.deliveries.length; i++) {
          const delivery = clientData.deliveries[i];

          console.log(`  📍 [PROCESS] Livraison ${i + 1}/${clientData.deliveries.length}`);

          let distanceKm = 0;
          let deliveryStatus = delivery.status;

          try {
            console.log(`  🌐 [PROCESS] Calcul distance...`);
            const result = await (this.distanceService as any).getRouteDistanceKm(
              delivery.warehouseAddress,
              delivery.destination_address,
            );

            const km = Number(result?.km ?? 0);
            const fromCache = Boolean(result?.fromCache);

            if (!Number.isFinite(km) || km <= 0) {
              console.warn(`  ⚠️ [PROCESS] Distance invalide km=${km}`);
              deliveryStatus = 'ADDRESS_NOT_FOUND';
            } else {
              distanceKm = km;
              deliveryStatus = 'DISTANCE_OK';
              successfulDeliveries++;
              console.log(fromCache ? `  🧠 [PROCESS] Cache: ${km.toFixed(2)} km` : `  🌍 [PROCESS] Google: ${km.toFixed(2)} km`);
            }

            if (!fromCache) await this.delay(200);
          } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`  ❌ [PROCESS] Erreur distance: ${msg}`);
            deliveryStatus = 'CALCULATION_ERROR';
          }

          console.log(`  💾 [PROCESS] Enregistrement livraison...`);
          await this.withTimeoutFn(
            () =>
              this.databaseService.createDelivery({
                upload_id: uploadId,
                client_id: client.id,
                delivery_date: this.parseDate(delivery.date),
                origin_warehouse: delivery.warehouse,
                origin_address: delivery.warehouseAddress,
                destination_address: delivery.destination_address,
                distance_km: distanceKm,
                price_ht: 0,
                price_ttc: 0,
                status: deliveryStatus,
              }) as unknown as PromiseLike<any>,
            25000,
            'CREATE_DELIVERY',
          );

          processedCount++;
        }

        console.log(`   💾 [PROCESS] Mise à jour client... (${successfulDeliveries} livraisons OK)`);
        await this.withTimeoutFn(
          () =>
            this.databaseService.updateClient(client.id, {
              total_deliveries: successfulDeliveries,
              total_amount_ht: 0,
              total_amount_ttc: 0,
            }) as unknown as PromiseLike<any>,
          20000,
          'UPDATE_CLIENT',
        );

        totalClients++;
        console.log(`✅ [PROCESS] Client "${clientName}" terminé`);
      }

      // ✅ 3) CRITIQUE : Mise à jour du statut de l'upload
      console.log(`\n🏁 [PROCESS] FINALISATION - Mise à jour upload vers "distances_done"`);
      console.log(`   📊 Total livraisons traitées: ${processedCount}`);
      console.log(`   👥 Total clients: ${totalClients}`);

      await this.withTimeoutFn(
        () =>
          this.databaseService.updateUpload(uploadId, {
            status: 'distances_done',
            total_deliveries: processedCount,
            total_clients: totalClients,
            total_amount: 0,
          }) as unknown as PromiseLike<any>,
        20000,
        'UPDATE_UPLOAD_DONE',
      );

      console.log(`🎉 [PROCESS] ✅ TERMINÉ avec succès !`);
      console.log(`   Upload: ${uploadId}`);
      console.log(`   Status: distances_done`);
      console.log(`   Livraisons: ${processedCount}`);
      console.log(`   Clients: ${totalClients}`);

      return { 
        success: true, 
        processed: processedCount, 
        clients: totalClients 
      };

    } catch (error: any) {
      console.error(`\n💥 [PROCESS] ❌ ÉCHEC upload=${uploadId}`);
      console.error(`   Erreur: ${error?.message || error}`);

      try {
        console.log(`🛑 [PROCESS] Mise à jour upload vers "failed"`);
        await this.withTimeoutFn(
          () => this.databaseService.updateUpload(uploadId, { status: 'failed' }) as unknown as PromiseLike<any>,
          20000,
          'UPDATE_UPLOAD_FAILED',
        );
        console.log(`✅ [PROCESS] Statut "failed" enregistré`);
      } catch (e: any) {
        console.error(`❌ [PROCESS] Impossible de mettre à jour le statut: ${e?.message || e}`);
      }

      throw error;
    }
  }

  private async findClientByName(uploadId: string, clientName: string) {
    const name = (clientName || '').trim();
    if (!name) return null;

    const { data, error } = await this.databaseService
      .getClient()
      .from('clients')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('name', name)
      .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  }

  private buildFullAddress(delivery: ParsedDelivery): string {
    const parts = [
      delivery.number, 
      delivery.street, 
      delivery.postalCode, 
      delivery.city, 
      delivery.country
    ]
      .map((p) => (p ?? '').toString().trim())
      .filter((p) => p.length > 0);

    return parts.join(', ');
  }

  private parseDate(dateStr: string): string {
    const parts = (dateStr || '').split('/');
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const yyyy = parts[2];
      return `${yyyy}-${mm}-${dd}`;
    }
    return dateStr;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}