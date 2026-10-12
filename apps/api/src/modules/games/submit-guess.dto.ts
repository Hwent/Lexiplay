import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class SubmitGuessDto {
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @Length(3, 9)
  @Matches(/^[a-zA-Z]+$/)
  guess!: string;
}
