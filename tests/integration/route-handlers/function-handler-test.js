import { module, test } from 'qunit';
import { Promise } from 'rsvp';
import $ from 'jquery';
const { ajax } = $;

import { Model, Collection, Serializer } from 'ember-cli-mirage';
import Server from 'ember-cli-mirage/server';
import Response from 'ember-cli-mirage/response';
import FunctionRouteHandler from 'ember-cli-mirage/route-handlers/function';
import _uniqBy from 'lodash/uniqBy';
import promiseAjax from '../../helpers/promise-ajax';

module('Integration | Route handlers | Function handler', function(hooks) {
  hooks.beforeEach(function() {
    this.server = new Server({
      environment: 'development',
      models: {
        user: Model.extend({
        })
      },
      serializers: {
        sparseUser: Serializer.extend({
          attrs: ['id', 'name', 'tall']
        })
      }
    });
    this.server.timing = 0;
    this.server.logging = false;

    this.functionHandler = new FunctionRouteHandler(this.server.schema, this.server.serializerOrRegistry);
    this.schema = this.server.schema;
  });

  hooks.afterEach(function() {
    this.server.shutdown();
  });

  test('a meaningful error is thrown if a custom route handler throws an error', async function(assert) {
    assert.expect(1);

    this.server.get('/users', function() {
      throw 'I goofed';
    });

    try {
      await promiseAjax({
        method: 'GET',
        url: '/users'
      });
    } catch(e) {
      assert.equal(
        e.xhr.responseText,
        'Mirage: Your GET handler for the url /users threw an error: I goofed'
      );
    }
  });

  test('mirage response string is not serialized to string', async function(assert) {
    assert.expect(1);

    this.server.get('/users', function() {
      return new Response(200, { 'Content-Type': 'text/csv' }, 'firstname,lastname\nbob,dylon');
    });

    let { data } = await promiseAjax({ method: 'GET', url: '/users' });
    assert.equal(data, 'firstname,lastname\nbob,dylon');
  });

  test('function can return a promise with non-serializable content', async function(assert) {
    assert.expect(1);

    this.server.get('/users', function() {
      return new Promise(resolve => {
        resolve(new Response(200, { 'Content-Type': 'text/csv' }, 'firstname,lastname\nbob,dylan'));
      });
    });

    let { data } = await promiseAjax({ method: 'GET', url: '/users' });
    assert.equal(data, 'firstname,lastname\nbob,dylan');
  });

  test('function can return a promise with serializable content', async function(assert) {
    assert.expect(1);

    let user = this.schema.users.create({ name: 'Sam' });

    this.server.get('/users', function(schema) {
      return new Promise(resolve => {
        resolve(schema.users.all());
      });
    });

    let { data } = await promiseAjax({ method: 'GET', url: '/users' });
    assert.deepEqual(data, { users: [ { id: user.id, name: 'Sam' } ] });
  });

  test('function can return a promise with an empty string', async function(assert) {
    assert.expect(1);

    this.server.get('/users', function() {
      return new Promise(resolve => {
        resolve(new Response(200, { 'Content-Type': 'text/csv' }, ''));
      });
    });

    let { data } = await promiseAjax({ method: 'GET', url: '/users' });
    assert.equal(data, '');
  });

  test('function can customize the reponse code via the 3rd argument', async function(assert) {
    assert.expect(1);
    this.schema.users.create({ name: 'Sam' });

    this.server.get('/users/1', schema => {
      return schema.users.first();
    }, 304);

    let request = await promiseAjax({ method: 'GET', url: '/users/1' });
    assert.equal(request.xhr.status, 304);
  });

  test('function can return an instance of Response', async function(assert) {
    let done = assert.async();
    assert.expect(2);

    this.server.get('/users', schema => {
      return new Response(422, { some: 'header' }, { some: 'data' });
    });

    try {
      await ajax({ url: '/users' });
    } catch(request) {
      assert.equal(request.status, 422);
      assert.deepEqual(request.responseJSON, { some: 'data' });
    } finally {
      done();
    }
  });

  test('returning a non-blank response from a custom handler whose default status is 204 changes the status to 200', async function(assert) {
    let done = assert.async();
    assert.expect(2);

    this.server.put('/users', () => {
      return { some: 'data' };
    });

    try {
      let request = await promiseAjax({
        url: `/users`,
        method: 'PUT',
        data: JSON.stringify({ request: 'data' })
      });

      assert.equal(request.xhr.status, 200, 'The status code is 200 instead of 204');
      assert.deepEqual(request.data, { some: 'data' }, 'The response is correct');
    } finally {
      done();
    }
  });

  test('#serialize uses the default serializer on a model', async function(assert) {
    let done = assert.async();
    this.schema.users.create({ name: 'Sam' });

    this.server.get('/some-request', function(schema) {
      return this.serialize(schema.users.first());
    });

    let json = await ajax({ url: '/some-request' });

    assert.deepEqual(json, {
      user: {
        id: '1',
        name: 'Sam'
      }
    });
    done();
  });

  test('#serialize uses the default serializer on a collection', async function(assert) {
    let done = assert.async();
    this.schema.users.create({ name: 'Sam' });

    this.server.get('/some-request', function(schema) {
      return this.serialize(schema.users.all());
    });

    let json = await ajax({ url: '/some-request' });

    assert.deepEqual(json, {
      users: [
        { id: '1', name: 'Sam' }
      ]
    });
    done();
  });

  test('#serialize takes an optional serializer type', async function(assert) {
    let done = assert.async();
    this.schema.users.create({ name: 'Sam', tall: true, evil: false });
    this.schema.users.create({ name: 'Ganondorf', tall: true, evil: true });

    this.server.get('/some-request', function(schema) {
      return this.serialize(schema.users.all(), 'sparse-user');
    });

    let json = await ajax({ url: '/some-request' });

    assert.deepEqual(json, {
      users: [
        { id: '1', name: 'Sam', tall: true },
        { id: '2', name: 'Ganondorf', tall: true }
      ]
    });
    done();
  });

  test('#serialize throws an error when trying to specify a serializer that doesnt exist', function(assert) {
    this.schema.users.create({ name: 'Sam' });

    let users = this.schema.users.all();

    assert.throws(function() {
      this.functionHandler.serialize(users, 'foo-user');
    }, /that serializer doesn't exist/);
  });

  test('#serialize noops on plain JS arrays', function(assert) {
    this.server.schema.users.create({ name: 'Sam' });
    this.server.schema.users.create({ name: 'Sam' });
    this.server.schema.users.create({ name: 'Ganondorf' });

    let users = this.schema.users.all().models;
    let uniqueNames = _uniqBy(users, 'name');
    let serializedResponse = this.functionHandler.serialize(uniqueNames);

    assert.deepEqual(serializedResponse, uniqueNames);
  });

  test('#serialize on a Collection takes an optional serializer type', function(assert) {
    this.server.schema.users.create({ name: 'Sam', tall: true, evil: false });
    this.server.schema.users.create({ name: 'Sam', tall: true, evil: false });
    this.server.schema.users.create({ name: 'Ganondorf', tall: true, evil: true });

    let users = this.schema.users.all().models;
    let uniqueNames = _uniqBy(users, 'name');
    let collection = new Collection('user', uniqueNames);
    let json = this.functionHandler.serialize(collection, 'sparse-user');

    assert.deepEqual(json, {
      users: [
        { id: '1', name: 'Sam', tall: true },
        { id: '3', name: 'Ganondorf', tall: true }
      ]
    });
  });
});
