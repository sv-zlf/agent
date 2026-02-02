import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as fs from 'fs';
import * as path from 'path';

const markdownPath = path.join(__dirname, '../docs/使用说明.md');
const outputPath = path.join(__dirname, '../docs/使用说明.docx');

function generateDocx() {
  const markdownContent = fs.readFileSync(markdownPath, 'utf-8');
  const lines = markdownContent.split('\n');

  const children: any[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let currentText: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        const codeText = codeLines.join('\n');
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeText,
                font: 'Courier New',
                size: 20,
              }),
            ],
            spacing: {
              before: 120,
              after: 120,
            },
          })
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushText();
      flushList();

      const level = Math.min(headingMatch[1].length, 3);
      children.push(
        new Paragraph({
          text: headingMatch[2],
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: {
            before: 240,
            after: 120,
          },
        })
      );
      continue;
    }

    if (line.trim() === '---') {
      flushText();
      flushList();
      children.push(
        new Paragraph({
          text: '',
          spacing: {
            after: 240,
          },
        })
      );
      continue;
    }

    if (line.startsWith('|') && line.includes('|') && line.split('|').length > 2) {
      flushText();
      flushList();
      continue;
    }

    const listMatch = line.match(/^(\s*[-*+]|\s*\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushText();
      if (!inList) {
        inList = true;
        listItems = [];
      }
      listItems.push(listMatch[2]);
      continue;
    }

    if (line.trim() === '') {
      flushList();
      currentText.push('');
      continue;
    }

    if (inList) {
      flushList();
    }

    currentText.push(line);
  }

  flushText();
  flushList();

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: children,
      },
    ],
  });

  Packer.toBuffer(doc)
    .then((buffer) => {
      fs.writeFileSync(outputPath, buffer);
      console.log(`✓ DOCX 文档已生成: ${outputPath}`);
    })
    .catch((error) => {
      console.error('生成 DOCX 文档时出错:', error);
      process.exit(1);
    });

  function flushText() {
    if (currentText.length > 0) {
      const text = currentText.join('\n').trim();
      if (text) {
        const textParts = text.split('\n');
        textParts.forEach((part) => {
          if (part.trim()) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: part,
                    size: 24,
                  }),
                ],
                spacing: {
                  after: 120,
                },
              })
            );
          }
        });
      }
      currentText = [];
    }
  }

  function flushList() {
    if (inList && listItems.length > 0) {
      listItems.forEach((item) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '• ',
                bold: true,
              }),
              new TextRun({
                text: item,
                size: 24,
              }),
            ],
            indent: {
              left: 720,
            },
            spacing: {
              after: 120,
            },
          })
        );
      });
      inList = false;
      listItems = [];
    }
  }
}

generateDocx();
