import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import axios from 'axios';

type PostgrestResult<T> = { data: T | null; error: any | null };

type RouteCacheRow = {
  distance_meters: number | null;
  duration_seconds: number | null;
  status: 'ok' | 'error' | string | null;
  error_message: string | null;
};

@Injectable()
export class DistanceService {
  constructor(private readonly db: DatabaseService) {}

  private normalizeAddress(s: string) {
    return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
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
      return await Promise.race([Promise.resolve(fn()) as Promise<T>, timeoutPromise]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async getRouteDistanceKm(originAddress: string, destinationAddress: string): Promise<{ km: number; fromCache: boolean }> {
    const origin_norm = this.normalizeAddress(originAddress);
    const destination_norm = this.normalizeAddress(destinationAddress);

    if (!origin_norm || !destination_norm) {
      throw new BadRequestException('Origin ou destination vide');
    }

    // 1) Cache lookup (best effort)
    try {
      const cachedRes = await this.withTimeoutFn<PostgrestResult<RouteCacheRow>>(
        () =>
          this.db
            .getClient()
            .from('route_cache')
            .select('distance_meters, duration_seconds, status, error_message')
            .eq('origin_norm', origin_norm)
            .eq('destination_norm', destination_norm)
            .maybeSingle() as unknown as PromiseLike<PostgrestResult<RouteCacheRow>>,
        7000,
        'CACHE_LOOKUP',
      );

      const cached = cachedRes.data;
      const cacheErr = cachedRes.error;

      if (!cacheErr && cached) {
        if (cached.status === 'ok' && typeof cached.distance_meters === 'number' && cached.distance_meters > 0) {
          return { km: cached.distance_meters / 1000, fromCache: true };
        }
        if (cached.status === 'error') {
          throw new BadRequestException(cached.error_message || 'Distance en cache en erreur');
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ [DIST] cache lookup skipped: ${e?.message || e}`);
    }

    // 2) Google call
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new BadRequestException('GOOGLE_MAPS_API_KEY manquante');

    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        params: {
          origins: originAddress,
          destinations: destinationAddress,
          key: apiKey,
          mode: 'driving',
          language: 'fr',
          units: 'metric',
        },
        timeout: 15000,
      });

      const data = res.data;
      const element = data?.rows?.[0]?.elements?.[0];

      const elementStatus = element?.status;
      const globalStatus = data?.status;

      if (!element || elementStatus !== 'OK' || globalStatus !== 'OK') {
        const msg = String(elementStatus || globalStatus || 'UNKNOWN_ERROR');

        // best-effort cache error
        try {
          await this.withTimeoutFn(
            () =>
              this.db.getClient().from('route_cache').upsert(
                { origin_norm, destination_norm, status: 'error', error_message: `Google Distance Matrix: ${msg}` },
                { onConflict: 'origin_norm,destination_norm' },
              ) as unknown as PromiseLike<any>,
            7000,
            'CACHE_UPSERT_ERROR',
          );
        } catch (e: any) {
          console.warn(`⚠️ [DIST] cache upsert error skipped: ${e?.message || e}`);
        }

        throw new BadRequestException(`Google Distance Matrix: ${msg}`);
      }

      const meters = Number(element.distance?.value ?? NaN);
      const seconds = Number(element.duration?.value ?? NaN);

      if (!Number.isFinite(meters) || meters <= 0) {
        throw new BadRequestException('Google Distance Matrix: DISTANCE_INVALID');
      }

      // best-effort cache ok
      try {
        await this.withTimeoutFn(
          () =>
            this.db.getClient().from('route_cache').upsert(
              {
                origin_norm,
                destination_norm,
                distance_meters: meters,
                duration_seconds: Number.isFinite(seconds) ? seconds : null,
                status: 'ok',
                error_message: null,
              },
              { onConflict: 'origin_norm,destination_norm' },
            ) as unknown as PromiseLike<any>,
          7000,
          'CACHE_UPSERT_OK',
        );
      } catch (e: any) {
        console.warn(`⚠️ [DIST] cache upsert ok skipped: ${e?.message || e}`);
      }

      return { km: meters / 1000, fromCache: false };
    } catch (err: any) {
      const msg = err?.message || 'Erreur Google';
      // best-effort cache error
      try {
        await this.withTimeoutFn(
          () =>
            this.db.getClient().from('route_cache').upsert(
              { origin_norm, destination_norm, status: 'error', error_message: String(msg) },
              { onConflict: 'origin_norm,destination_norm' },
            ) as unknown as PromiseLike<any>,
          7000,
          'CACHE_UPSERT_CATCH',
        );
      } catch {}

      throw new BadRequestException(String(msg));
    }
  }
}
