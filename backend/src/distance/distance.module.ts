import { Module } from '@nestjs/common';
import { DistanceService } from './distance.service';
import { DatabaseService } from '../database/database.service';

@Module({
  providers: [DistanceService, DatabaseService],
  exports: [DistanceService],
})
export class DistanceModule {}
