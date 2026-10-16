import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { SaveWordDto } from '../word-lists/word-list.dto';

export class GuestWordDto extends SaveWordDto {
  @IsIn(['KNOWN', 'UNFAMILIAR']) status!: 'KNOWN' | 'UNFAMILIAR';
}
export class ProgressTransferDto {
  @IsUUID() accountId!: string;
  @IsUUID() transferId!: string;
  @IsOptional() @IsUUID() lastGameId?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GuestWordDto)
  words!: GuestWordDto[];
}
