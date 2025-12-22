import {
  Controller,
  Get,
  Param,
  Res,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { InvoiceService } from './invoice.service';

@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly db: DatabaseService,
    private readonly invoiceService: InvoiceService,
  ) {}

  private extractBearerToken(req: Request): string | null {
    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2) return null;
    if (parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1].trim();
  }

  private async getUser(req: Request) {
    const token = this.extractBearerToken(req);
    if (!token) {
      throw new ForbiddenException(
        'Non authentifié (token manquant). Veuillez vous reconnecter.',
      );
    }

    const { data, error } = await this.db.getClient().auth.getUser(token);

    if (error || !data?.user) {
      throw new ForbiddenException(
        'Session invalide ou expirée. Veuillez vous reconnecter.',
      );
    }
    return data.user;
  }

  private async assertUploadOwnedByUser(uploadId: string, userId: string) {
    const { data: up, error: upErr } = await this.db
      .getClient()
      .from('uploads')
      .select('id, user_id')
      .eq('id', uploadId)
      .single();

    if (upErr) throw upErr;

    if (!up || up.user_id !== userId) {
      throw new ForbiddenException('Accès refusé à cet upload');
    }
  }

  // ✅ OVERVIEW DASHBOARD
  @Get(':uploadId/overview')
  async overview(@Param('uploadId') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const data = await this.invoiceService.getUploadOverview(uploadId);
      return { success: true, ...data };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur overview');
    }
  }

  // ✅ COMPAT: route attendue par ton front (/invoice/:uploadId/clients)
  @Get(':uploadId/clients')
  async clients(@Param('uploadId') uploadId: string, @Req() req: Request) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      // on renvoie la même structure que overview, ou juste la liste
      const data = await this.invoiceService.getUploadOverview(uploadId);
      return { success: true, clients: data.clients, totals: data.totals };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur clients');
    }
  }

  // ✅ ZIP : 1 PDF par client
  @Get(':uploadId/zip')
  async downloadZip(
    @Param('uploadId') uploadId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="factures_${uploadId}.zip"`,
      );

      await this.invoiceService.streamInvoicesZip(uploadId, res);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur génération ZIP');
    }
  }

  // ✅ PDF d’un client (⚠️ doit rester EN DERNIER)
  @Get(':uploadId/:clientId')
  async downloadInvoice(
    @Param('uploadId') uploadId: string,
    @Param('clientId') clientId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = await this.getUser(req);
      await this.assertUploadOwnedByUser(uploadId, user.id);

      const pdf = await this.invoiceService.generateClientInvoicePdf(
        uploadId,
        clientId,
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="facture_${clientId}.pdf"`,
      );

      res.end(pdf);
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new BadRequestException(err?.message || 'Erreur génération PDF');
    }
  }
}
