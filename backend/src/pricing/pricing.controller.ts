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
  price_ht: number | string;
  tva_rate: number | string;
};

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * Reçoit la grille de tarification de la page (tranches)
   * puis:
   * 1) enregistre la grille (pricing_config)
   * 2) applique le prix sur deliveries
   * 3) met à jour totals clients + upload
   */
  @Post(':uploadId/apply')
  async apply(
    @Param('uploadId') uploadId: string,
    @Body() body: { pricing: PricingInputRow[] },
  ) {
    try {
      if (!uploadId) throw new BadRequestException('uploadId manquant');
      if (!body?.pricing || !Array.isArray(body.pricing) || body.pricing.length === 0) {
        throw new BadRequestException('Grille pricing vide');
      }

      const result = await this.pricingService.applyPricingToUpload(
        uploadId,
        body.pricing,
      );

      return { success: true, ...result };
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur apply pricing');
    }
  }

  /**
   * Résumé des totaux calculés en base après apply
   */
  @Get(':uploadId/summary')
  async summary(@Param('uploadId') uploadId: string) {
    try {
      return await this.pricingService.getUploadBillingSummary(uploadId);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur summary');
    }
  }
}
