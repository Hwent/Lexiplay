import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { VOCABULARY_RANGE_IDS, VocabularyRange } from './vocabulary-ranges';
export class StartGameDto {
  @IsOptional() @IsIn([3, 4, 5, 6, 7, 8, 9]) wordLength?: number;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: 'easy' | 'medium' | 'hard';
  @IsOptional() @IsBoolean() playWithMyWords?: boolean;
  @IsOptional() @IsIn(['word-puzzle']) kind?: 'word-puzzle';
  @IsOptional() @IsIn(VOCABULARY_RANGE_IDS) vocabularyRange?: VocabularyRange;
}
export class HintDto { @IsString() @IsIn(['unused', 'present']) type!: 'unused' | 'present'; }
