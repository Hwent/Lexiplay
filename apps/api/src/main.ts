import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureHttp, serverConfig } from './http-setup';

async function bootstrap() {
  const config = serverConfig();
  if (config.publicOrigin) process.env.PUBLIC_WEB_ORIGIN = config.publicOrigin;
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  console.log(`API_LISTENING=${await app.getUrl()}`);
}

void bootstrap().catch(error => { console.error(error instanceof Error ? error.message : 'Could not start the API.'); process.exitCode = 1; });
