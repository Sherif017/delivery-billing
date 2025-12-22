import { Module } from '@nestjs/common';
import { ProcessingService } from './processing.service';
import { DatabaseService } from '../database/database.service';
import { DistanceService } from '../distance/distance.service';
import { PricingService } from '../pricing/pricing.service';

@Module({
  providers: [ProcessingService, DatabaseService, DistanceService, PricingService],
  exports: [ProcessingService],
})
export class ProcessingModule {}