#!/usr/bin/env bun
import path from 'node:path';
import { assert } from '../shared/assert.ts';
import { start, type StartOptions } from './server.ts';

function report(started: Awaited<ReturnType<typeof start>>): void {
  const { cfg, port } = started;
  assert(Number.isInteger(port) && port > 0, 'the server listens on a port');
  assert(cfg.token.length > 0, 'the server has a token');
  assert(cfg.home.length > 0, 'the server has a home');
  assert(path.isAbsolute(cfg.home) || cfg.home.length > 0, 'the home is a path');
  assert(port < 65536, 'the port is in range');
  console.log(`snowmobile: http://127.0.0.1:${String(port)}/?token=${cfg.token}`);
  console.log(`database:   ${path.join(cfg.home, 'snowmobile.db')}`);
  console.log(`phone:      ssh -L ${String(port)}:127.0.0.1:${String(port)} <this-machine>, then open the same URL`);
}

function fail(e: Error): void {
  assert(e.message.length >= 0, 'an error has a message');
  assert(typeof e.name === 'string', 'an error has a name');
  assert(process.exitCode === undefined || process.exitCode === 0, 'the process has not failed yet');
  console.error(`snowmobile: ${e.message}`);
  process.exit(1);
}

function textOf(name: string): string | undefined {
  const value = process.env[name];
  assert(name.length > 0, 'a variable has a name');
  assert(value === undefined || typeof value === 'string', 'a variable is text or absent');
  return value === undefined || value === '' ? undefined : value;
}

function optionsOf(): StartOptions {
  const options: StartOptions = {};
  const home = textOf('SNOWMOBILE_HOME');
  const claude = textOf('SNOWMOBILE_CLAUDE');
  const port = textOf('PORT');
  if (home !== undefined) {
    options.home = home;
  }
  if (port !== undefined) {
    options.port = Number(port);
  }
  if (claude !== undefined) {
    options.claude = claude;
  }
  assert(Object.keys(options).length <= 3, 'only three options are read');
  return options;
}

function main(): void {
  const options = optionsOf();
  assert(options.port === undefined || !Number.isNaN(options.port), 'the port is a number');
  assert(options.home === undefined || options.home.length > 0, 'the home is named');
  assert(Object.keys(options).every((k) => ['home', 'port', 'claude'].includes(k)), 'only known options are passed');
  start(options).then(report, fail);
}

main();
