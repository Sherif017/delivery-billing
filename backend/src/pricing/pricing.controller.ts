import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { PricingService } from './pricing.service';

type PricingInputRow = {
  range_start: number | string;
  range_end: number | string | null;
  price_ht?: number | string; // legacy front
  price?: number | string;    // DB = price
  tva_rate: number | string;
};

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post(':uploadId/apply')
  async apply(
    @Param('uploadId') uploadId: string,
    @Body() body: { pricing?: PricingInputRow[] },
  ) {
    try {
      if (!uploadId || typeof uploadId !== 'string') {
        throw new BadRequestException('uploadId manquant');
      }

      const pricing = body?.pricing;
      if (!pricing || !Array.isArray(pricing) || pricing.length === 0) {
        throw new BadRequestException('Grille pricing vide');
      }

      const result = await this.pricingService.applyPricingToUpload(uploadId, pricing);
      return { success: true, ...result };
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur apply pricing');
    }
  }

  @Get(':uploadId/config')
  async config(@Param('uploadId') uploadId: string) {
    try {
      if (!uploadId || typeof uploadId !== 'string') {
        throw new BadRequestException('uploadId manquant');
      }

      const pricing = await this.pricingService.getPricingConfigForUpload(uploadId);
      return { success: true, uploadId, pricing };
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur config');
    }
  }

  @Get(':uploadId/summary')
  async summary(@Param('uploadId') uploadId: string) {
    try {
      if (!uploadId || typeof uploadId !== 'string') {
        throw new BadRequestException('uploadId manquant');
      }

      const summary = await this.pricingService.getUploadBillingSummary(uploadId);

      // ⚠️ summary peut déjà contenir "success", donc on évite le doublon
      return { uploadId, ...summary };
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur summary');
    }
  }
}
