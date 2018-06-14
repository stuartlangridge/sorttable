/* global SORTRESULTS, document */
/* eslint no-console: 0 */


module.exports = function(grunt) {
    require("load-grunt-tasks")(grunt);
    
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        eslint: {
            target: ["Gruntfile.js"]
        }
    });

    grunt.registerTask("build-tests",
        "Actually build the HTML test files", function() {
            var fs = require("fs"), Mustache=require("mustache");
            var rootdir = __dirname + "/tests/";
            var done = this.async();
            grunt.log.write("Deleting existing tests\n");
            fs.readdirSync(rootdir).forEach(function(fn) {
                if (fn.match(/^test-.*\.html$/)) {
                    fs.unlinkSync(rootdir + fn);
                }
            });

            grunt.log.write("Reading JSON description of tests\n");
            fs.readFile(rootdir + "test-definitions.json", "utf8", function(err, data) {
                if (err) { return done(false); }
                fs.readFile(rootdir + "template.html", "utf8", function(err, template) {
                    if (err) { return done(false); }
                    var testdata = JSON.parse(data);
                    var suitelist = [];
                    for (var suite in testdata.tests) {
                        suitelist.push(suite);
                    }

                    function next() {
                        var suite = suitelist.shift();
                        if (!suite) {
                            done();
                            return;
                        }

                        console.log("Processing suite", suite);
                        var suite_rows = testdata.tests[suite].rows;
                        var sortresults = testdata.tests[suite].expected_column_1_after_sort_by_column_n;
                        
                        var columns = []; // should be range(0, columncount)
                        for (var i=0; i<sortresults.length; i++) {
                            columns.push(i);
                        }

                        var rows = [];
                        suite_rows.forEach(function(suite_row) {
                            rows.push({row: suite_row});
                        });

                        var template_data = {
                            columns: columns,
                            rows: rows,
                            suite: suite,
                            json_sortresults: JSON.stringify(sortresults)
                        };

                        var html = Mustache.render(template, template_data);

                        fs.writeFile(rootdir + "test-" + suite + ".html", html, function(err) {
                            if (err) throw(err);
                            next();
                        });
                    }

                    next();
                });
            });
        });

    grunt.registerTask("run-tests-with-puppeteer",
        "Execute all the test files with puppeteer", function() {

            var path = require("path");
            var fs = require("fs"),
                rootdir = __dirname + "/tests/";
            var done = this.async();
            const puppeteer = require("puppeteer");

            function fileUrl(str) {
                var pathName = path.resolve(str).replace(/\\/g, "/");
                // Windows drive letter must be prefixed with a slash
                if (pathName[0] !== "/") { pathName = "/" + pathName; }
                return encodeURI("file://" + pathName);
            }

            const testFn = () => {
                var tf = [];
                function ass(statement, truefalse) { tf.push([statement, truefalse]); }

                var tbl = document.querySelector("table.sortable");
                /* Check the test was set up right: that is, that we
                   have the same number of tuples in SORTRESULTS as
                   we do columns, and that a SORTRESULTS tuple has the
                   same number of entries as there are rows in a column 
                   (note that there will be one extra row, because
                   of the column headers) 
                */
                ass("SORTRESULTS has an entry per column " +
                    "(comparing number of SORTRESULTS=" +
                    SORTRESULTS.length + " with number of cells in table row 0=" +
                    tbl.rows[0].cells.length + ")",
                SORTRESULTS.length === tbl.rows[0].cells.length);
                ass("SORTRESULTS entries have one item per row",
                    SORTRESULTS[0].length === tbl.rows.length - 1);

                var evObj;
                for (var columnindex=0; columnindex < SORTRESULTS.length; columnindex++) {
                    // Generate a click on the column header
                    evObj = document.createEvent("MouseEvents");
                    evObj.initEvent("click", true, true);
                    tbl.rows[0].cells[columnindex].dispatchEvent(evObj);

                    // Now check each item in column 1 against SORTRESULTS
                    // The -1 stuff in here is because the rows in the *table* go
                    // from 1 to N and skip 0 because that's where the column headers are
                    // but the entries in the SORTRESULTS tuple go from 0 to N-1
                    for (var rowindex=1; rowindex < tbl.rows.length; rowindex++) {
                        ass("Sorted on column " + (columnindex+1) + "; " +
                            "comparing row " + rowindex + " predicted value '" +
                            SORTRESULTS[columnindex][rowindex-1] +
                            "' with actual value '" +
                            tbl.rows[rowindex].cells[0].innerHTML + "'",
                        tbl.rows[rowindex].cells[0].innerHTML == SORTRESULTS[columnindex][rowindex-1]);
                    }
                }
                return tf;
            };


            fs.readdir(rootdir, function(err, files) {
                var testFiles = [];
                files.forEach(function(fn) {
                    if (fn.match(/^test-.*\.html$/)) {
                        testFiles.push(fn);
                    }
                });

                function next() {
                    var fn = testFiles.shift();
                    if (!fn) {
                        done();
                        return;
                    }
                    console.log("=== Testing: ", fn);
                    var ffn = fileUrl(rootdir + fn);

                    puppeteer.launch({executablePath: "/usr/bin/chromium-browser"}).then(async browser => {
                        const page = await browser.newPage();
                        await page.goto(ffn);
                        const results = await page.evaluate(testFn);
                        await browser.close();

                        let errs = results.filter((textpassed) => { return !textpassed[1]; })
                            .map(([textpassed]) => { return textpassed[0]; });
                        if (errs.length > 0) {
                            console.error("Failed tests");
                            console.log(errs.join("\n"));
                        }
                    }).then(function() {
                        next();
                    });
                }

                next();
            });
        });

    // Default task(s).
    grunt.registerTask("test", [
        "eslint",
        "build-tests",
        "run-tests-with-puppeteer",
    ]);

    grunt.registerTask("default", ["test"]);
};