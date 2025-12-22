import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { DatabaseService } from '../database/database.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService, DatabaseService],
  exports: [PricingService],
})
export class PricingModule {}
