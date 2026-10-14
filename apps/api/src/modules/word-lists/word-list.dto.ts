import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AddDictionaryWordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  term!: string;
}

export class SaveWordDto {
  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z '-]{0,99}$/)
  term!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  definition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  partOfSpeech?: string;
}

export class UpdateWordDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z '-]{0,99}$/)
  term?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  definition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  partOfSpeech?: string;

  @IsOptional()
  @IsIn(['KNOWN', 'UNFAMILIAR'])
  status?: 'KNOWN' | 'UNFAMILIAR';
}

export class ImportWordDto {
  @IsInt()
  rowNumber!: number;

  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z '-]{0,99}$/)
  term!: string;

  @IsString()
  @MaxLength(500)
  definition!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  partOfSpeech?: string | null;

  @IsBoolean()
  selected!: boolean;

  @IsOptional()
  @IsArray()
  issues?: string[];
}

export class ConfirmWordImportDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportWordDto)
  rows!: ImportWordDto[];
}
