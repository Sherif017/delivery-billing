import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

 app.enableCors({
  origin: (origin, callback) => {
    // origin = undefined pour curl/postman/serveur-à-serveur
    if (!origin) return callback(null, true);

    const allowedExact = new Set([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://delivery-billing.vercel.app',
    ]);

    // Autoriser les previews vercel (optionnel mais utile)
    const isVercelPreview =
      /^https:\/\/.*\.vercel\.app$/.test(origin);

    if (allowedExact.has(origin) || isVercelPreview) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
});


  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`✅ API listening on http://localhost:${port}`);
}

bootstrap();
