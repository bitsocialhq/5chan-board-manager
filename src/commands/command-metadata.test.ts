import { describe, it, expect } from 'vitest'
import Start from './start.js'
import BoardAdd from './board/add.js'
import BoardList from './board/list.js'
import BoardRemove from './board/remove.js'

describe('command metadata for oclif readme generation', () => {
  it('start command has examples', () => {
    expect(Start.examples).toBeDefined()
    expect(Start.examples!.length).toBeGreaterThan(0)
  })

  it('board add command has examples', () => {
    expect(BoardAdd.examples).toBeDefined()
    expect(BoardAdd.examples!.length).toBeGreaterThan(0)
  })

  it('board list command has examples', () => {
    expect(BoardList.examples).toBeDefined()
    expect(BoardList.examples!.length).toBeGreaterThan(0)
  })

  it('board remove command has examples', () => {
    expect(BoardRemove.examples).toBeDefined()
    expect(BoardRemove.examples!.length).toBeGreaterThan(0)
  })
})
