'use strict';

const tls = require('tls');
const utils = require('../utils');
const Client = require('../client');

/**
 *  Constructor for a Jayson TLS-encrypted TCP Client
 *  @class ClientTls
 *  @constructor
 *  @extends Client
 *  @param {Object|String} [options] Object goes into options for tls.connect, String goes into options.path. String option argument is NOT recommended.
 *  @return {ClientTls}
 */
const ClientTls = function(options) {
  if(typeof(options) === 'string') {
    options = {path: options};
  }

  if(!(this instanceof ClientTls)) {
    return new ClientTls(options);
  }
  Client.call(this, options);

  const defaults = utils.merge(this.options, {
    encoding: 'utf8'
  });

  this.options = utils.merge(defaults, options || {});
};
require('util').inherits(ClientTls, Client);

module.exports = ClientTls;

ClientTls.prototype._request = function(request, callback) {
  const self = this;

  // copies options so object can be modified in this context
  const options = utils.merge({}, this.options);

  utils.JSON.stringify(request, options, function(err, body) {
    if (err) return callback(err);

    let handled = false;
    if (!self.conn) {
      self.conn = tls.connect(options, function() {
        self.conn.setEncoding(options.encoding);
      });

      self.conn.on('error', function(err) {
        self.emit('tcp error', err);
        callback(err);
      });

      self.conn.on('end', function() {
        if (!handled) {
          callback();
        }
      });
    }
    // wont get anything for notifications, just end here
    if (utils.Request.isNotification(request)) {

      handled = true;
      self.conn.write(body + '\n');
      // self.conn.end(body + '\n');
      callback();

    } else {

      utils.parseStream(self.conn, options, function(err, response) {
        handled = true;
        // self.conn.end();
        if (err) {
          return callback(err);
        }
        callback(null, response);
      });

      self.conn.write(body + '\n');
        
    }
  });
};
