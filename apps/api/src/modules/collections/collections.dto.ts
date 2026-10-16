import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
export class CollectionQuery {
  @IsOptional() @IsString() @MaxLength(60) category?: string;
}
export class GameCollectionsQuery {
  @Matches(/^[3-9]$/) wordLength!: string;
}
export class CollectionWordsQuery {
  @IsOptional() @IsIn(['families']) view?: string;
  @IsOptional() @IsIn(['due']) review?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(40) partOfSpeech?: string;
  @IsOptional() @IsIn(['Foundation','Core','Advanced']) stage?: string;
  @IsOptional() @Matches(/^\d{1,6}$/) page?: string;
  @IsOptional() @Matches(/^(?:[1-9]|[1-9]\d|100)$/) pageSize?: string;
  @IsOptional() @IsIn(['en']) language?: string;
}
export class NewPersonalList {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @IsIn(['en']) preferredLanguage?: string;
}
export class ImportCollection {
  @IsString() @MinLength(1) @MaxLength(100) collectionId!: string;
  @ValidateIf((_object,value)=>value!==undefined) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ArrayUnique() @IsUUID('all',{each:true}) selectedWordIds?: string[];
  @IsOptional() @IsIn(['skip']) duplicatePolicy?: 'skip';
}
export class UpdatePersonalEntry {
  @IsOptional() @IsIn(['Foundation','Core','Advanced']) stage?: string;
  @IsOptional() @IsInt() @Min(0) @Max(5) familiarity?: number;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}
export class AddDictionaryEntries {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({each:true}) @MinLength(1,{each:true}) @MaxLength(100,{each:true}) terms!: string[];
}
