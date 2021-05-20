'use strict';

const tls = require('tls');
const utils = require('../utils');
const Client = require('../client');
const uuid = require('uuid');

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

let requests = [];
ClientTls.prototype._request = function(request, callback) {
  const self = this;

  // copies options so object can be modified in this context
  const options = utils.merge({}, this.options);
  const isNotification = utils.Request.isNotification(request);
  const req = {
    id: request.id || uuid.v4(),
    callback,
    handled: false,
  };

  utils.JSON.stringify(request, options, function(err, body) {
    if (err) return req.callback(err);

    if (!self.conn) {
      self.conn = tls.connect(options, function() {
        self.conn.id = uuid.v4();
        self.conn.setEncoding(options.encoding);
      });

      /*
       * this logs all incoming data... only use in dev cases
      self.conn.on('data', (str) => {
        console.log('data: ', str);
      });
       */

      self.conn.on('error', function(err) {
        // console.log('tls client error', self.conn.id);
        self.emit('tcp error', err);
        req.callback(err);
      });

      self.conn.on('end', function() {
        // console.log('tls client end', self.conn.id);
        if (!req.handled) {
          req.handled = true;
          req.callback();
        }
      });

      utils.parseStream(self.conn, options, async function(err, response) {
        const r = requests.find((x) => x.id === response.id);
        // if we dont have a request matching the id, its an incoming message
        if (!r && response.method) {
          // console.log('incoming rpc message:', response);
          if (self.options.server) {
            self.options.server.call(response, context, (e, res) => {
              // console.log('rpc server call', e, res);
              self.conn.write(JSON.stringify(res)+'\n');
            });
          }
          return response;
        }

        // no logged request, should have been handled above as incoming message
        // or if somehow the request has already been handled...
        if (!r || r.handled) return;

        r.handled = true;
        if (err) {
          await r.callback(err);
        } else {
          await r.callback(null, response);
        }

        // remove this request from our listener / callback map
        const idx = requests.findIndex((x) => x.id === r.id);
        if (idx >= 0) requests.splice(idx, 1);
      });
    }

    // dont need to hold on to callbacks for notifications
    if (!isNotification) requests.push(req);
    const context = {conn: self.conn};
    // NOW send the actual message
    self.conn.write(body + '\n');

    // wont get anything for notifications, just end here
    if (isNotification) {
      req.handled = true;
      req.callback();
    }
  });
};
