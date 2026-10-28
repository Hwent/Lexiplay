import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
export class StartGameDto {
  @IsOptional() @IsUUID() startRequestId?: string;
  @IsOptional() @IsUUID() wordListId?: string;
  @IsOptional() @IsString() @MaxLength(100) collectionId?: string;
  @IsOptional() @IsIn([3, 4, 5, 6, 7, 8, 9]) wordLength?: number;
  // Accept cached clients' difficulty values; new word puzzles always use medium.
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: 'easy' | 'medium' | 'hard';
  @IsOptional() @IsBoolean() playWithMyWords?: boolean;
  @IsOptional() @IsIn(['word-puzzle', 'wordle', 'word-ladder']) kind?: 'word-puzzle' | 'wordle' | 'word-ladder';
}
export class HintDto { @IsString() @IsIn(['definition', 'nextWord']) type!: 'definition' | 'nextWord'; }
