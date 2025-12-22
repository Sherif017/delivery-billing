import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { DistanceService } from './distance/distance.service';

@Controller()
export class AppController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly distanceService: DistanceService,
  ) {}

  @Get()
  getHello() {
    return { ok: true, message: 'API OK' };
  }

  @Get('test-db')
  async testDb() {
    const { data, error } = await this.databaseService
      .getClient()
      .from('uploads')
      .select('*')
      .limit(1);

    return { ok: !error, error, data };
  }

  @Get('test-distance')
  async testDistance() {
    // 👉 Adapte ces deux adresses si besoin
    const origin = '10 rue de la Paix, 75002 Paris, France';
    const dest = '20 avenue de l’Opéra, 75001 Paris, France';

    const r = await this.distanceService.getRouteDistanceKm(origin, dest);

    return {
      ok: true,
      origin,
      destination: dest,
      km: r.km,
      fromCache: r.fromCache,
    };
  }
}
