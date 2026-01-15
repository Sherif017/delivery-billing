import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class DatabaseService implements OnModuleInit {
  /**
   * supabasePublic:
   * - Utilise l'ANON KEY (utile pour vérifier l'utilisateur avec un JWT via auth.getUser(token))
   */
  private supabasePublic: SupabaseClient;

  /**
   * supabaseAdmin:
   * - Utilise la SERVICE ROLE KEY (backend uniquement)
   * - Bypass RLS
   */
  private supabaseAdmin: SupabaseClient;

  private storageBucket: string;
  private supabaseUrl: string;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    // Bucket par défaut (peut être surchargé via .env)
    this.storageBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET') || 'Kilomate-uploads';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error(
        'Missing Supabase credentials in .env file. Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
      );
    }

    this.supabaseUrl = supabaseUrl;

    this.supabasePublic = createClient(supabaseUrl, anonKey);
    this.supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  }

  async onModuleInit() {
    // logs utiles pour débug prod/dev
    const projectRef = this.extractProjectRef(this.supabaseUrl);

    console.log(`🧩 Supabase URL: ${this.supabaseUrl}`);
    console.log(`🧩 Supabase project ref: ${projectRef ?? 'UNKNOWN'}`);
    console.log(`🧩 Storage bucket configured: "${this.storageBucket}"`);

    await this.assertBucketExistsOrThrow(this.storageBucket);
  }

  private extractProjectRef(url: string): string | null {
    try {
      const u = new URL(url);
      const host = u.hostname; // xxxxxx.supabase.co
      const parts = host.split('.');
      // xxxxxx.supabase.co -> xxxxxx
      return parts[0] || null;
    } catch {
      return null;
    }
  }

  private async assertBucketExistsOrThrow(bucketId: string) {
    const { data, error } = await this.supabaseAdmin.storage.listBuckets();
    if (error) {
      console.error('❌ storage.listBuckets error:', error);
      throw error;
    }

    const buckets = (data ?? []).map((b: any) => b.id);
    if (!buckets.includes(bucketId)) {
      console.error(`❌ Bucket introuvable: "${bucketId}"`);
      console.error(`✅ Buckets disponibles: ${buckets.join(', ') || '(none)'}`);
      throw new Error(
        `Bucket not found: "${bucketId}". Vérifie SUPABASE_URL et SUPABASE_STORAGE_BUCKET.`,
      );
    }

    console.log(`✅ Bucket trouvé: "${bucketId}"`);
  }

  /**
   * ⚠️ Par défaut on renvoie le client ADMIN (pour éviter les erreurs RLS dans le backend)
   */
  getClient(): SupabaseClient {
    return this.supabaseAdmin;
  }

  getPublicClient(): SupabaseClient {
    return this.supabasePublic;
  }

  // -------------------------
  // Storage helpers (Supabase Storage)
  // -------------------------

  /**
   * Upload un fichier local vers Supabase Storage.
   * Retourne { bucket, storage_path } à stocker en DB.
   */
  async uploadLocalFileToStorage(params: {
    localPath: string;
    originalName: string;
    userId: string;
    uploadId: string;
  }): Promise<{ bucket: string; storage_path: string }> {
    const { localPath, originalName, userId, uploadId } = params;

    const fileBuffer = await fs.promises.readFile(localPath);

    const safeName = this.safeFilename(originalName || 'upload');
    const ext = path.extname(safeName) || '';
    const base = ext ? safeName.slice(0, -ext.length) : safeName;

    // Exemple: uploads/<userId>/<uploadId>/<timestamp>_name.xlsx
    const storage_path = `uploads/${userId}/${uploadId}/${Date.now()}_${base}${ext}`;

    const { error } = await this.supabaseAdmin.storage
      .from(this.storageBucket)
      .upload(storage_path, fileBuffer, {
        contentType: this.guessMimeType(ext),
        upsert: false,
      });

    if (error) {
      console.error('❌ Storage upload error:', {
        bucket: this.storageBucket,
        storage_path,
        message: (error as any)?.message,
        name: (error as any)?.name,
      });
      throw error;
    }

    return { bucket: this.storageBucket, storage_path };
  }

  /**
   * Télécharge un fichier depuis Storage vers un chemin temporaire local.
   */
  async downloadStorageFileToTemp(params: {
    bucket?: string;
    storage_path: string;
  }): Promise<string> {
    const bucket = params.bucket || this.storageBucket;

    const { data, error } = await this.supabaseAdmin.storage
      .from(bucket)
      .download(params.storage_path);

    if (error) throw error;
    if (!data) throw new Error('Storage download: empty response');

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = path.extname(params.storage_path) || '.bin';
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kilomate-'));
    const tmpPath = path.join(tmpDir, `file${ext}`);

    await fs.promises.writeFile(tmpPath, buffer);
    return tmpPath;
  }

  /**
   * Nettoie un fichier temporaire (best effort)
   */
  async cleanupTempFile(tmpPath: string) {
    try {
      const dir = path.dirname(tmpPath);
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  private guessMimeType(ext: string) {
    const e = (ext || '').toLowerCase();
    if (e === '.xlsx')
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (e === '.xls') return 'application/vnd.ms-excel';
    if (e === '.csv') return 'text/csv';
    return 'application/octet-stream';
  }

  private safeFilename(name: string) {
    return (
      String(name ?? '')
        .replace(/[^\p{L}\p{N}\s._-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 120) || 'file'
    );
  }

  // -------------------------
  // Uploads
  // -------------------------
  async createUpload(payload: { filename: string; user_id: string }) {
    const { data, error } = await this.supabaseAdmin
      .from('uploads')
      .insert({
        filename: payload.filename,
        user_id: payload.user_id,
        status: 'processing',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateUpload(
    uploadId: string,
    updates: {
      status?: string;
      total_deliveries?: number;
      total_clients?: number;
      total_amount?: number;
      user_id?: string;
      pricing_tiers?: any;

      storage_bucket?: string;
      storage_path?: string;
    },
  ) {
    const { data, error } = await this.supabaseAdmin
      .from('uploads')
      .update(updates)
      .eq('id', uploadId)
      .select()
      .single();

    if (error) {
      console.error('❌ Erreur updateUpload:', error);
      throw error;
    }

    console.log(`✅ Upload ${uploadId} mis à jour:`, updates);
    return data;
  }

  async getUploadById(uploadId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error) throw error;
    return data;
  }

  // -------------------------
  // Clients
  // -------------------------
  async createClient(clientData: any) {
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async findClientByName(uploadId: string, name: string) {
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('name', name);

    if (error) {
      console.error('❌ Erreur findClientByName:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async updateClient(id: string, updates: any) {
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getClientsByUpload(uploadId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .select('*')
      .eq('upload_id', uploadId)
      .order('name');

    if (error) throw error;
    return data;
  }

  // ✅ utilisé par l'optimisation (typing propre)
  async getClientsBasicByUpload(uploadId: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .select('id, name')
      .eq('upload_id', uploadId);

    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  }

  // -------------------------
  // Deliveries
  // -------------------------
  async createDelivery(deliveryData: any) {
    const { data, error } = await this.supabaseAdmin
      .from('deliveries')
      .insert(deliveryData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async createDeliveriesBatch(rows: any[]) {
    if (!rows || rows.length === 0) return true;

    const { error } = await this.supabaseAdmin.from('deliveries').insert(rows);
    if (error) throw error;

    return true;
  }

  async getDeliveriesByClient(clientId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('deliveries')
      .select('*')
      .eq('client_id', clientId)
      .order('delivery_date');

    if (error) throw error;
    return data;
  }

  // -------------------------
  // Pricing config
  // -------------------------
  async getPricingConfig() {
    const { data, error } = await this.supabaseAdmin
      .from('pricing_config')
      .select('*')
      .order('range_start');

    if (error) throw error;
    return data;
  }

  // -------------------------
  // Pending deliveries
  // -------------------------
  async createPendingDelivery(row: any) {
    const { data, error } = await this.supabaseAdmin
      .from('pending_deliveries')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /**
   * Insert batch (chunks) pour pending_deliveries
   */
  async createPendingDeliveriesBatch(rows: any[], chunkSize = 200) {
    if (!rows || rows.length === 0) return [];

    const chunks = this.chunkArray(rows, chunkSize);
    const inserted: any[] = [];

    for (const chunk of chunks) {
      const { data, error } = await this.supabaseAdmin
        .from('pending_deliveries')
        .insert(chunk)
        .select('id');

      if (error) throw error;
      if (data) inserted.push(...data);
    }

    return inserted;
  }

  async getPendingDeliveriesByUpload(uploadId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('pending_deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .order('is_valid', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getInvalidDeliveriesByUpload(uploadId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('pending_deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('is_valid', false);

    if (error) throw error;
    return data;
  }

  async updatePendingDelivery(id: string, updates: any) {
    const { data, error } = await this.supabaseAdmin
      .from('pending_deliveries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deletePendingDeliveriesByUpload(uploadId: string) {
    const { error } = await this.supabaseAdmin
      .from('pending_deliveries')
      .delete()
      .eq('upload_id', uploadId);

    if (error) throw error;
  }

  // -------------------------
  // Batch helpers (perf) — NEW
  // -------------------------

  async upsertClientsBatch(uploadId: string, rows: any[]) {
    if (!rows || rows.length === 0) return [];

    // nécessite UNIQUE(upload_id, name) en DB
    const { data, error } = await this.supabaseAdmin
      .from('clients')
      .upsert(rows, { onConflict: 'upload_id,name' })
      .select('id, name');

    if (error) throw error;
    return data ?? [];
  }

   async updateClientsTotalsBatch(
    updates: Array<{
      id: string;
      total_deliveries: number;
      total_amount_ht: number;
      total_amount_ttc: number;
    }>,
  ) {
    if (!updates || updates.length === 0) return true;

    const { error } = await this.supabaseAdmin.rpc('update_clients_totals_batch', {
      p_updates: updates,
    });

    if (error) throw error;
    return true;
  }
  async deleteDeliveriesByUpload(uploadId: string) {
  const { error } = await this.supabaseAdmin
    .from('deliveries')
    .delete()
    .eq('upload_id', uploadId);

  if (error) throw error;
}


}
