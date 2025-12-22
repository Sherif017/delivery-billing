import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';
import { UploadModule } from './upload/upload.module';
import { DistanceModule } from './distance/distance.module';
import { PricingModule } from './pricing/pricing.module';
import { ProcessingModule } from './processing/processing.module';
import { DistanceService } from './distance/distance.service';
import { PricingService } from './pricing/pricing.service';
import { InvoiceModule } from './invoice/invoice.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UploadModule,
    DistanceModule,
    PricingModule,
    ProcessingModule,
    InvoiceModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService, DistanceService, PricingService],
})
export class AppModule {}
