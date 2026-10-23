#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_BASE_URL, HttpGeorefBackend } from './backend.js';
import { createServer } from './server.js';

const baseUrl = process.env.GEOREF_BASE_URL || DEFAULT_BASE_URL;
const server = createServer(new HttpGeorefBackend(baseUrl));
await server.connect(new StdioServerTransport());
// stdout carries the protocol; logs must go to stderr.
console.error(`georef-mcp running on stdio (${baseUrl})`);
