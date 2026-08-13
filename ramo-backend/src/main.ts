import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow requests from local development and the deployed production frontend.
  // The production URL is read from an environment variable so it isn't hardcoded
  // in source code and can be changed without a code deploy.
  const allowedOrigins = ['http://localhost:4200'];

  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Render assigns a dynamic port via the PORT environment variable;
  // fall back to 3000 for local development.
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
