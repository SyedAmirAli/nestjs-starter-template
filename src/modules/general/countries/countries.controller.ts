import { Controller, Get, NotFoundException, Param, Query, StreamableFile } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { CountryType } from './countries';
import { PaginatedResult } from '@/common/prisma-query-builder.service';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Controller('countries')
export class CountriesController {
    constructor(private readonly countriesService: CountriesService) {}

    @Get()
    @AllowAnonymous()
    @ApiQuery({ type: QueryParamsDto })
    @ApiResponse({ status: 200, description: 'Countries list' })
    async findAll(@Query() query: QueryParamsDto): Promise<PaginatedResult<CountryType>> {
        return await this.countriesService.findAll(query);
    }

    @Get('languages')
    @AllowAnonymous()
    @ApiOperation({
        summary: 'List languages',
        description:
            'Languages across countries, de-duplicated by ISO 639-1 code. Both filters are ' +
            'case-insensitive and combine: `countries` narrows which countries are read, ' +
            '`codes` narrows the languages themselves.',
    })
    @ApiQuery({
        name: 'countries',
        required: false,
        description: 'ISO 3166-1 alpha-2 country codes, comma-separated. Alias: `items`.',
        example: 'BD,IN,PK',
    })
    @ApiQuery({
        name: 'codes',
        required: false,
        description: 'ISO 639-1 language codes, comma-separated.',
        example: 'bn,en',
    })
    @ApiQuery({
        name: 'flag',
        required: false,
        description: 'Include the country flag SVG. The flag emoji is always returned.',
        example: 'true',
    })
    @ApiResponse({ status: 200, description: 'Languages list' })
    async languages(@Query() query: any): Promise<any> {
        return await this.countriesService.languages(query);
    }

    @Get(':identifier')
    @AllowAnonymous()
    @ApiResponse({ status: 200, description: 'Country details' })
    async findOne(@Param('identifier') identifier: string): Promise<CountryType | null> {
        return await this.countriesService.findOne(identifier);
    }

    @Get(':identifier/flag')
    @AllowAnonymous()
    @ApiResponse({ status: 200, description: 'Country flag' })
    async flag(
        @Param('identifier') identifier: string,
        @Query('type') type?: 'largeFlag' | 'flag',
    ): Promise<StreamableFile> {
        const svg = await this.countriesService.flag(identifier, type);
        if (!svg) throw new NotFoundException('Country flag not found');

        return new StreamableFile(Buffer.from(svg, 'utf-8'), {
            type: 'image/svg+xml',
        });
    }
}
