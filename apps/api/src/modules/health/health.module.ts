import { Controller, Get, Module } from '@nestjs/common';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' as const };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
