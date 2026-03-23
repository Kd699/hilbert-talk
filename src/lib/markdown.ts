import React from 'react'

export function renderContent(text: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''
  let blockIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        blocks.push(
          React.createElement('pre', { key: `code-${blockIndex++}`, 'data-lang': codeLang },
            React.createElement('code', null, codeLines.join('\n'))
          )
        )
        inCodeBlock = false
        codeLines = []
        codeLang = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (line.trim() === '') continue

    const rendered = renderInline(line, blockIndex)

    if (line.startsWith('# ')) {
      blocks.push(React.createElement('h1', { key: `h-${blockIndex++}` }, line.slice(2)))
    } else if (line.startsWith('## ')) {
      blocks.push(React.createElement('h2', { key: `h-${blockIndex++}` }, line.slice(3)))
    } else if (line.startsWith('### ')) {
      blocks.push(React.createElement('h3', { key: `h-${blockIndex++}` }, line.slice(4)))
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push(React.createElement('li', { key: `li-${blockIndex++}` }, rendered))
    } else {
      blocks.push(React.createElement('p', { key: `p-${blockIndex++}` }, rendered))
    }
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    blocks.push(
      React.createElement('pre', { key: `code-${blockIndex++}`, 'data-lang': codeLang },
        React.createElement('code', null, codeLines.join('\n'))
      )
    )
  }

  return blocks
}

function renderInline(line: string, _blockIndex: number): React.ReactNode[] {
  const parts = line.split(/(`[^`]+`)/)
  return parts.map((part, j) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return React.createElement('code', { key: j }, part.slice(1, -1))
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/)
    return boldParts.map((bp, k) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return React.createElement('strong', { key: `${j}-${k}` }, bp.slice(2, -2))
      }
      return bp
    })
  })
}
