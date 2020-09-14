// SPDX-License-Identifier: Apache-2.0
// Copyright 2020 Andrew Madigan

import fontkit from 'fontkit';
import {readFile, rename, writeFile} from 'fs';
import {createHash} from 'crypto';
import ttf2woff2 from 'ttf2woff2';
import {promisify} from 'util';
import {Octokit} from '@octokit/rest';
import {ReposGetContentResponseData} from '@octokit/types';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import mkdirp from 'mkdirp';

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const renameAsync = promisify(rename);
const octokit = new Octokit();

async function getRelease(repo: {owner: string, repo: string}): Promise<{version: string, tag: string}> {
  const resp = await octokit.repos.listReleases({...repo, per_page: 100});

  const year = new Date(resp.data[0].published_at).getFullYear();

  const micro = resp.data.filter(release => new Date(release.published_at).getFullYear() == year).length - 1;

  return {version: `1.${year}.${micro}`, tag: resp.data[0].tag_name};
}

async function listFontFiles(repo: {owner: string, repo: string}, tag: string, path: string): Promise<string[]> {
  const resp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path}?per_page=3000&ref=${encodeURIComponent(tag)}`, 
                            {headers: {accept: 'application/vnd.github.v3+json'}});

  const files = await resp.json() as ReposGetContentResponseData[];

  return files.filter(f => f.name.endsWith('.ttf')).map(f => f.download_url);
}

type Range = {start: number, end: number};

type FontStyle = 'normal' | 'italic' | 'oblique';
type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type FontStretch = 'normal' | 'ultra-condensed' | 'extra-condensed' | 'condensed' | 'semi-condensed' | 'semi-expanded' | 
                    'expanded' | 'extra-expanded' | 'ultra-expanded';

type CSSFontFile = {source: string, format: 'woff' | 'woff2' | 'truetype' | 'opentype' | 'embedded-opentype' | 'svg'};

type CSSFontFace = {
  fontFamily: string,
  fontStyle: FontStyle,
  fontWeight: FontWeight,
  fontStretch: FontStretch,
  unicodeRange: string,
  source: CSSFontFile[]
}

type FaceDiscriminator = Record<string, Partial<Omit<CSSFontFace, 'fontFamily' | 'unicodeRange'>>>;

const defaultPropertyValues = {
  'font-style': 'normal',
  'font-weight': 400,
  'font-stretch': 'normal'
};

const faceDiscriminators = {
  Italic: {fontStyle: 'italic'},
  Thin: {fontWeight: 100},
  ExtraLight: {fontWeight: 200},
  Light: {fontWeight: 300},
  Regular: {fontWeight: 400},
  Medium: {fontWeight: 500},
  SemiBold: {fontWeight: 600},
  Bold: {fontWeight: 700},
  ExtraBold: {fontWeight: 800},
  Black: {fontWeight: 900},
  SemiCondensed: {fontStretch: 'semi-condensed'},
  Condensed: {fontStretch: 'condensed'},
  ExtraCondensed: {fontStretch: 'extra-condensed'}
} as FaceDiscriminator;

type FontFile = {
  postscriptName: string,
  fullName: string,
  familyName: string,
  subfamilyName: string,
  copyright: string,
  version: number,
  unitsPerEm: number,
  ascent: number,
  descent: number,
  lineGap: number,
  underlinePosition: number,
  underlineThickness: number,
  italicAngle: number,
  capHeight: number,
  xHeight: number,
  numGlyphs: number,
  ranges: Range[]
}

export type FontFace = FontFile & {
  css: CSSFontFace
}

function getRanges(points: number[]) : Range[] {
  const codePoints = new Uint32Array(points);
  codePoints.sort();

  let range = {start: codePoints[0], end: codePoints[0]};
  const rv = [range];

  for (let i = 1; i < codePoints.length; i++) {
    const point = codePoints[i];
    if (point != range.end + 1) {
      range = {start: point, end: point};
      rv.push(range);
    } else {
      range.end = point;
    }
  }

  return rv;
}

function pointToString(point: number): string {
  const str = new Number(point).toString(16);

  switch (str.length) {
    case 1: return '00000' + str;
    case 2: return '0000' + str;
    case 3: return '000' + str;
    case 4: return '00' + str;
    case 5: return '0' + str;
    case 6: return str;
    default:
      throw new Error('Unsupported code point ' + str);
  }
}

function trim(str: string): string {
  for (let i = 0; i < str.length; i++) {
    if (str[i] != '0') {
      return str.substr(i);
    }
  }

  return '0';
}

// Not used for now, makes some unicode ranges shorter using wildcards, but is not well supported
/*
function makeWilcard(start: string, end: string): string|null {
  let i = start.length - 1;

  for (; i >= 0; i--) {
    if (start[i] !== '0' || end[i] !== 'f') {
      break;
    }
  }

  const startPrefix = start.substr(0, i + 1);
  const endPrefix = end.substr(0, i + 1);

  if (startPrefix === endPrefix) {
    let prefix = trim(startPrefix);

    if (prefix === '0') {
      prefix = '';
    }

    switch (startPrefix.length) {
      case 1: return prefix + '?????';
      case 2: return prefix + '????';
      case 3: return prefix + '???';
      case 4: return prefix + '??';
      case 5: return prefix + '?'
      default: return prefix === '' ? '0' : prefix;
    }
  }

  return null;
}
*/

function rangeToString(range: Range): string {
  const start = pointToString(range.start);
  const end = pointToString(range.end);

  if (start === end) {
    return 'U+' + trim(start);
  }

  return 'U+' + trim(start) + '-' + trim(end);
}

async function processFont(buffer: Buffer, outdir: string): Promise<FontFile & {file: string}> {
  const font = fontkit.create(buffer);

  const ranges = getRanges(font.characterSet);

  const {
    postscriptName, fullName, familyName, subfamilyName, copyright, version, unitsPerEm, 
    ascent, descent, lineGap, underlinePosition, underlineThickness, italicAngle, capHeight, xHeight, numGlyphs
  } = font;

  const fontFile = {
    postscriptName, fullName, familyName, subfamilyName, copyright, version, unitsPerEm, ascent, 
    descent, lineGap, underlinePosition, underlineThickness, italicAngle, capHeight, xHeight, numGlyphs, ranges
    };

  const woff2 = ttf2woff2(buffer);

  const sha256 = createHash('sha256');

  sha256.write(woff2);

  const filename = `${fontFile.fullName.replace(/\s+/g, '')}.${sha256.digest('hex')}.woff2`;

  await writeFileAsync(`${outdir}/${filename}`, buffer);

  return {...fontFile, file: filename};
}

function parseFontFile(family: string, file: FontFile): FontFace {
  if (!file.fullName.startsWith(family)) {
    throw new Error(`Unrecognized font name ${file.fullName}, does not start with ${family}`);
  }

  const discriminators = file.fullName.substr(family.length).trim().split(/\s+/);

  let face = {
    fontFamily: family,
    fontStretch: defaultPropertyValues['font-stretch'],
    fontStyle: defaultPropertyValues['font-style'],
    fontWeight: defaultPropertyValues['font-weight'],
    unicodeRange: file.ranges.map(rangeToString).join(', ')
  } as CSSFontFace;

  for (const disc of discriminators) {
    if (!(disc in faceDiscriminators)) {
      throw new Error(`Unrecognized font discrimator ${disc} in ${file.fullName}`);
    }

    const discriminator = faceDiscriminators[disc];
    face = {...face, ...discriminator};
  }

  return {...file, css: face};
}

function generateCSS(face: CSSFontFace): string {
  let css = '@font-face {\n';
  css += `  font-display: swap;\n`
  css += `  font-family: '${face.fontFamily}';\n`
  css += `  unicode-range: ${face.unicodeRange};\n`

  const source = face.source.map(src => `url(${src.source}) format("${src.format}")`).join(',\n      ');

  css += `  src: ${source};\n`;
  
  if (face.fontStyle !== defaultPropertyValues['font-style']) {
    css += `  font-style: ${face.fontStyle};\n`;
  }

  if (face.fontWeight !== defaultPropertyValues['font-weight']) {
    css += `  font-weight: ${face.fontWeight};\n`;
  }

  if (face.fontStretch !== defaultPropertyValues['font-stretch']) {
    css += `  font-stretch: ${face.fontStretch};\n`;
  }

  css += '}\n'

  return css;
}

type ConfigItem = {owner: string, repo: string, fonts: string[]};
type Config = ConfigItem[];

async function main(jsonFile: string, dir: string) {
  const jsonbuf = await readFileAsync(jsonFile);
  const config = JSON.parse(jsonbuf.toString('utf8')) as Config;

  for (const configItem of config) {
    const {version, tag} = await getRelease(configItem);
    console.log(`Release for ${configItem.owner}/${configItem.repo} -> ${version}`)

    for (const path of configItem.fonts) {
      const files = await listFontFiles(configItem, tag, path);
      console.log(`Processing ${files.length} files for ${configItem.owner}/${configItem.repo}/${path}`);
      await processRepoFont(configItem.owner, configItem.repo, version, dir, files);
    }
  }
}

async function processRepoFont(owner: string, repo: string, version: string, dir: string, list: string[]) {
  let targetDir = `${dir}/${uuidv4()}`;
  await mkdirp(targetDir);

  const files = [];

  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    console.log(`Processing ${url} (${i + 1}/${list.length})`);
    const resp = await fetch(url);
    const buf = Buffer.from(await resp.arrayBuffer());
    files.push(await processFont(buf, targetDir));
  }

  let familyName = '';

  for (const file of files) {
    if (familyName === '' || file.familyName.length < familyName.length) {
      familyName = file.familyName;
    }
  }

  familyName = familyName.trim();
  
  const faces = [];

  const jsonFiles = [];

  for (const fontFile of files) {
    const {file, ...jsonFile} = fontFile;
    const face = parseFontFile(familyName, fontFile);
    face.css.source = [{source: file, format: 'woff2'}];
    jsonFiles.push({...jsonFile, css: face.css});
    faces.push(face);
  }

  const baseName = familyName.replace(/\s+/g, '-').toLowerCase();

  const newDir = `${dir}/${baseName}`;
  await renameAsync(targetDir, newDir);
  targetDir = newDir;

  const variants = {} as Record<FontStretch, Record<FontWeight, CSSFontFace[]>>;

  for (const face of faces) {
    const css = face.css;
    let variant = variants[css.fontStretch];

    if (!variant) {
      variant = {} as Record<FontWeight, CSSFontFace[]>;
      variants[css.fontStretch] = variant;
    }

    const weightVariant = variant[css.fontWeight];

    if (!weightVariant) {
      variant[css.fontWeight] = [css];
    } else {
      weightVariant.push(css);
    }
  }

  const cssFiles = [];

  for (const stretch in variants) {
    const stretchVariants = variants[stretch as FontStretch];
    const stretchFiles = [];
    for (const weight in stretchVariants) {
      const faces = stretchVariants[parseInt(weight) as FontWeight];
      const css = faces.map(f=>generateCSS(f)).join('\n');
      const file = `${baseName}-${stretch}-${weight}.css`;
      stretchFiles.push(file);
      await writeFileAsync(`${targetDir}/${file}`, css, {encoding: 'utf8'});
    }

    const stretchCss = stretchFiles.map(f => `@import '${f}';\n`).join('');
    const stretchFile = `${baseName}-${stretch}.css`;
    cssFiles.push(stretchFile);
    await writeFileAsync(`${targetDir}/${stretchFile}`, stretchCss, {encoding: 'utf8'});
  }

  const css = cssFiles.map(f => `@import '${f}';\n`).join('');
  await writeFileAsync(`${targetDir}/${baseName}.css`, css, {encoding: 'utf8'});

  const json = JSON.stringify(jsonFiles, null, '  ');

  await writeFileAsync(`${targetDir}/${baseName}.json`, json, {encoding: 'utf8'});

  const varName = familyName.replace(/[^A-Za-z0-9_$]/g, '');

  const js = `const ${varName} = ${json};\n\nexport default ${varName};\n`;

  await writeFileAsync(`${targetDir}/index.ts`, js, {encoding: 'utf8'});
  await writeFileAsync(`${targetDir}/index.mjs`, js, {encoding: 'utf8'});

  await writeFileAsync(`${targetDir}/hello.js`, `console.log('Hello, World! This program is included to fulfill the requirements of the Open Font License');`, 
                        {encoding: 'utf8'});

  const packageJson = {
    name: `@bridgelightcloud/font-${baseName}`,
    version,
    description: `Package of ${familyName}`,
    main: 'hello.js',
    keywords: ['noto', 'font', 'woff2', baseName],
    author: 'bridgelightcloud',
    license: 'OFL-1.1',
    repository: {
      type: 'git',
      url: `https://github.com/${owner}/${repo}.git`
    }
  };

  await writeFileAsync(`${targetDir}/package.json`, JSON.stringify(packageJson, null, ' '), {encoding: 'utf8'});

  console.log(`Created ${targetDir}`);
}


main(process.argv[process.argv.length - 2], process.argv[process.argv.length - 1]).catch(console.log);