import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class DatabaseService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials in .env file');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  // Helper pour uploads
  async createUpload(filename: string) {
    const { data, error } = await this.supabase
      .from('uploads')
      .insert({ filename, status: 'processing' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ✅ CORRECTION : Méthode complète avec implémentation
  async updateUpload(
    uploadId: string,
    updates: {
      status?: string;
      total_deliveries?: number;
      total_clients?: number;
      total_amount?: number;
      user_id?: string;
      pricing_tiers?: any;
    },
  ) {
    const { data, error } = await this.supabase
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

  // Helper pour clients
  async createClient(clientData: any) {
    const { data, error } = await this.supabase
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async findClientByName(uploadId: string, name: string) {
    const { data, error } = await this.supabase
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
    const { data, error } = await this.supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getClientsByUpload(uploadId: string) {
    const { data, error } = await this.supabase
      .from('clients')
      .select('*')
      .eq('upload_id', uploadId)
      .order('name');

    if (error) throw error;
    return data;
  }

  // Helper pour deliveries
  async createDelivery(deliveryData: any) {
    const { data, error } = await this.supabase
      .from('deliveries')
      .insert(deliveryData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getDeliveriesByClient(clientId: string) {
    const { data, error } = await this.supabase
      .from('deliveries')
      .select('*')
      .eq('client_id', clientId)
      .order('delivery_date');

    if (error) throw error;
    return data;
  }

  // Helper pour pricing config
  async getPricingConfig() {
    const { data, error } = await this.supabase
      .from('pricing_config')
      .select('*')
      .order('range_start');

    if (error) throw error;
    return data;
  }

  // Helper pour pending_deliveries
  async createPendingDelivery(data: any) {
    const { data: result, error } = await this.supabase
      .from('pending_deliveries')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return result;
  }

  async getPendingDeliveriesByUpload(uploadId: string) {
    const { data, error } = await this.supabase
      .from('pending_deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .order('is_valid', { ascending: false });

    if (error) throw error;
    return data;
  }

  async getInvalidDeliveriesByUpload(uploadId: string) {
    const { data, error } = await this.supabase
      .from('pending_deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('is_valid', false);

    if (error) throw error;
    return data;
  }

  async updatePendingDelivery(id: string, updates: any) {
    const { data, error } = await this.supabase
      .from('pending_deliveries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deletePendingDeliveriesByUpload(uploadId: string) {
    const { error } = await this.supabase
      .from('pending_deliveries')
      .delete()
      .eq('upload_id', uploadId);

    if (error) throw error;
  }

  // ✅ AJOUT : Méthode pour récupérer un upload par ID
  async getUploadById(uploadId: string) {
    const { data, error } = await this.supabase
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .single();

    if (error) throw error;
    return data;
  }
}