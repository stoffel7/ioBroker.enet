/* eslint-disable jsdoc/require-param-description */
'use strict';

var discover = require('./discover');
var gateway = require('./gateway');

/**
 *
 * @param  config
 */
function eNet(config) {
    this._config = config;
}

module.exports.eNet = eNet;
module.exports.discover = discover;
module.exports.gateway = gateway;
