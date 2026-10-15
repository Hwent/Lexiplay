import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class GuestWordDto {
  @IsString() @MinLength(1) @MaxLength(100) term!: string;
  @IsOptional() @IsString() @MaxLength(500) definition?: string;
  @IsOptional() @IsString() @MaxLength(40) partOfSpeech?: string | null;
  @IsIn(['KNOWN', 'UNFAMILIAR']) status!: 'KNOWN' | 'UNFAMILIAR';
}
export class ProgressTransferDto {
  @IsUUID() accountId!: string;
  @IsUUID() transferId!: string;
  @IsOptional() @IsUUID() lastGameId?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GuestWordDto)
  words!: GuestWordDto[];
}
