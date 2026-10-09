import { ApiProperty } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsNotEmpty, IsString, Length } from 'class-validator';

export class AddressDto {
  @ApiProperty({ example: '221B Baker Street' })
  @IsString()
  @IsNotEmpty()
  street: string;

  @ApiProperty({ example: 'London' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'NW1 6XE' })
  @IsString()
  @Length(3, 10)
  postalCode: string;

  @ApiProperty({ example: 'GB' })
  @IsISO31661Alpha2()
  country: string;
}
