import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { DatabaseService } from '../database/database.service';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, DatabaseService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
