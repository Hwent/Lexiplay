import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { GamesModule } from './modules/games/games.module';

@Module({ imports: [HealthModule, GamesModule] })
export class AppModule {}
