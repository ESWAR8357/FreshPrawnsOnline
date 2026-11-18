import mongoose from 'mongoose'
import { initializeModelIndexes } from './modules/index.js'

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  })
  await initializeModelIndexes()
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function getDatabaseState(): 'connected' | 'disconnected' | 'connecting' | 'disconnecting' {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected'
    case 2:
      return 'connecting'
    case 3:
      return 'disconnecting'
    default:
      return 'disconnected'
  }
}
