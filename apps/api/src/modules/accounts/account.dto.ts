import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AccountCredentialsDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional() @IsString() @MaxLength(254)
  identifier?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class RegisterAccountDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString() @Matches(/^[a-z][a-z0-9_]{2,31}$/) username!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
export class RecoveryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}
export class ActionTokenDto { @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string; }
export class ResetPasswordDto extends ActionTokenDto { @IsString() @MinLength(8) @MaxLength(128) password!: string; }
