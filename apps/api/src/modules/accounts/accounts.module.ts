import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountController } from './account.controller';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  controllers: [AccountController],
  providers: [AccountRepository, AccountService],
  exports: [AccountService],
})
export class AccountsModule {}
