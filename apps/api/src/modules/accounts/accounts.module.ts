import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountController } from './account.controller';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';
import { AccountMailService } from './account-mail.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  controllers: [AccountController, CommunityController],
  providers: [AccountRepository, AccountService, AccountMailService],
  exports: [AccountService],
})
export class AccountsModule {}
