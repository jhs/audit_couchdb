# Audit CouchDB: The simple, clear, CouchDB security assessment

Audit CouchDB is a simple tool with a powerful message. Given an Apache CouchDB URL, it will tell you everything you ever wanted to know about its security.

## Objective

Audit CouchDB will perform the following actions:

1. Learn every possible fact about the couch, for example:

  * What is the server configuration?
  * What user accounts exist?
  * What user roles exist?
  * What databases exist?
  * In each database, what is the security setting?
  * In each design document, what are the validation functions?

2. Given the facts, compare them against each other and warn if they imply a security concern, for example:

  * You obviously didn't bother to click the "Security" link in the database page in Futon
  * Published CVE alerts apply to your version of CouchDB
  * A design document is missing a `validate_doc_update` function
  * Helpful summaries of how many admins, normal users, and anonymous users can access each database

## Usage

Currently, Audit CouchDB is a Node application distributed via NPM. Install it (globally) via `npm`.

    npm install -g audit_couchdb

Next, run the tool with your CouchDB URL as a parameter. You should connect as an admin user, so Audit CouchDB can fetch all possible information (such as the configuration).

    audit_couchdb https://admin:secret@localhost:5984

The tool will output everything it knows about your couch's security.

To see how `audit_couchdb` is working, set its log level to debug. It will show you each query it makes as it learns facts about your couch.

    audit_couchdb --level=debug https://admin:secret@localhost:5984

## Running from the Browser

Audit CouchDB is implemented as a library, depending on a back-end [request][req] library, and a front-end to display the output (simple console text output, or log4j if it is installed).

I recently re-implemented `request` in the browser as [jQuery Request][jreq]. Thus I am excited to see Audit CouchDB run on the browser, however I have not begun this work.

[req]: https://github.com/mikeal/request
[jreq]: https://github.com/iriscouch/request_jquery
