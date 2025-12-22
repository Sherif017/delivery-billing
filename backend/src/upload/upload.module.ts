import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { AddressValidatorService } from './address-validator.service';
import { DatabaseService } from '../database/database.service';
import { ProcessingModule } from '../processing/processing.module';

@Module({
  imports: [ProcessingModule],
  controllers: [UploadController],
  providers: [UploadService, DatabaseService, AddressValidatorService],
  exports: [AddressValidatorService],
})
export class UploadModule {}