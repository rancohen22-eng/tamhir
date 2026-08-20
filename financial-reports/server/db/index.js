'use strict';
// מופע Knex יחיד לכל האפליקציה, לפי NODE_ENV.
const knexLib = require('knex');
const config = require('./knexfile');

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const knex = knexLib(config[env]);

module.exports = knex;
module.exports.env = env;
