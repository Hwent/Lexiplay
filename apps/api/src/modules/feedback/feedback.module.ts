import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackRepository } from './feedback.repository';

@Module({ imports: [AccountsModule], controllers: [FeedbackController], providers: [FeedbackRepository] })
export class FeedbackModule {}
