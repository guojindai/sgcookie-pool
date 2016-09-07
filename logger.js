'use strict';

let winston = require('winston'),
    moment = require('moment');

exports.getLogger = function () {
  return new (winston.Logger)({
    transports: [
      new (winston.transports.Console)({
        timestamp: function() {
          return moment().format('YY-MM-DD HH:mm:ss');
        },
        formatter: function(options) {
          return options.timestamp() +' '+ options.level.toUpperCase() +' '+ (undefined !== options.message ? options.message : '') +
            (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
        }
      })
    ]
  });
};