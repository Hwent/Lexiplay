import { Equals, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AccountCredentialsDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional() @IsString() @MaxLength(254)
  identifier?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

export class RegisterAccountDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() || undefined : value)
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsBoolean() sendVerification?: boolean;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString() @Matches(/^[a-z\p{Script=Han}][a-z0-9_\p{Script=Han}]{2,31}$/u, { message: 'Username must be 3–32 Chinese characters, letters, numbers, or underscores, starting with a Chinese character or letter.' }) username!: string;
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
}
export class RecoveryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}
export class ActionTokenDto { @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string; }
export class ResetPasswordDto extends ActionTokenDto { @IsString() @MinLength(6) @MaxLength(128) password!: string; }
export class AddEmailDto extends RecoveryDto { @IsString() @MinLength(6) @MaxLength(128) password!: string; }
export class DeleteAccountDto {
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
  @IsString() @Equals('DELETE') confirmation!: string;
}
