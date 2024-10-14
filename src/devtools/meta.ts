import type { ViteDevServer } from 'vite'
import { kebabCase } from 'scule'
import defu from 'defu'
import fs from 'node:fs'
import { createResolver } from '@nuxt/kit'

const { resolve } = createResolver(import.meta.url)
const devtoolsComponentMeta: Record<string, any> = {}

function extractComponentMeta(code: string): string | null {
  const match = code.match(/extendDevtoolsMeta(?:<.*?>)?\(/)
  if (!match) return null

  const startIndex = code.indexOf(match[0]) + match[0].length
  let openBraceCount = 0
  let closeBraceCount = 0
  let endIndex = startIndex

  for (let i = startIndex; i < code.length; i++) {
    if (code[i] === '{') openBraceCount++
    if (code[i] === '}') closeBraceCount++

    if (openBraceCount > 0 && openBraceCount === closeBraceCount) {
      endIndex = i + 1
      break
    }
  }
  // Return only the object inside extendDevtoolsMeta
  return code.slice(startIndex, endIndex).trim()
}

// A Plugin to parse additional metadata for the Nuxt UI Devtools.
export function devtoolsMetaPlugin() {
  return {
    name: 'ui-devtools-component-meta',
    enforce: 'pre' as const,

    async transform(code: string, id: string) {
      if (!id.endsWith('.vue')) return
      const fileName = id.split('/')[id.split('/').length - 1]

      if (code && fileName) {
        const slug = kebabCase(fileName.replace(/\..*/, ''))
        const match = extractComponentMeta(code)
        if (match) {
          const metaObject = new Function(`return ${match}`)()
          devtoolsComponentMeta[slug] = { meta: { devtools: { ...metaObject } } }
        }
      }

      return {
        code
      }
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__nuxt_ui__/devtools/api/component-meta', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const componentMeta = await import('./.component-meta/component-meta')
        const meta = defu(
          Object.entries(componentMeta.default).reduce((acc, [key, value]: [string, any]) => {
            if (!key.startsWith('U')) return acc

            value.meta.props = value.meta.props.map((prop: any) => {
              let defaultValue = prop.default
                ? prop.default
                : prop?.tags?.find((tag: any) =>
                  tag.name === 'defaultValue'
                  && !tag.text?.includes('appConfig'))?.text

              if (typeof defaultValue === 'string') defaultValue = defaultValue?.replaceAll(/["'`]/g, '')
              if (defaultValue === 'true') defaultValue = true
              if (defaultValue === 'false') defaultValue = false
              if (!Number.isNaN(Number.parseInt(defaultValue))) defaultValue = Number.parseInt(defaultValue)

              return {
                ...prop,
                default: defaultValue
              }
            })

            acc[kebabCase(key.replace(/^U/, ''))] = value
            return acc
          }, {} as Record<string, any>),
          devtoolsComponentMeta
        )

        res.end(JSON.stringify(meta))
      })

      server.middlewares.use('/__nuxt_ui__/devtools/api/component-example', async (req, res) => {
        const query = new URL(req.url!, 'http://localhost').searchParams
        const componentName = query.get('component')
        if (!componentName) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Component name is required' }))
          return
        }

        try {
          const componentPath = resolve(`../runtime/examples/${componentName}.vue`)
          const sourceCode = fs.readFileSync(componentPath, 'utf-8')

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ component: componentName, source: sourceCode }))
        } catch (error) {
          console.error(`Failed to read component source for ${componentName}:`, error)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Failed to read component source' }))
        }
      })
    }
  }
}
