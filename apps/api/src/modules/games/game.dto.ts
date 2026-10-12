import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
export class StartGameDto {
  @IsOptional() @IsIn([3, 4, 5, 6, 7, 8, 9]) wordLength?: number;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: 'easy' | 'medium' | 'hard';
  @IsOptional() @IsBoolean() playWithMyWords?: boolean;
  @IsOptional() @IsIn(['word-puzzle']) kind?: 'word-puzzle';
}
export class HintDto { @IsString() @IsIn(['unused', 'present']) type!: 'unused' | 'present'; }
