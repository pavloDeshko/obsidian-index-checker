# Obsidian Index Checker Plugin

Make sure your index (MOC) files contain all links they should contain!

Simple and unopinionated obsidian plugin which will check if all the necessary links are included in your index (MOC) files, while allowing you to maintain complete control over their structure and formatting.
___

## Why?

Although there're a few community plugins for maintaining indexes, most of them enforce rigid structure (user defined in best cases) for all index files. What I was looking for is a more flexible solution that will simply check if all links are in place (and no files are "lost"), while allowing users to organize each of their index files in whatever way they prefer (and change it whenever they want!). Additionally, it should facilitate the addition of missing links to index files. Here's my solution to the problem, check it out :)
___

## How it works

:hammer_and_wrench: - user defines how plugin should find index(MOC) files based on their names. Example patterns could be "__index__", "__MOC__", "__\[FOLDER\]__", "___\[FOLDER\]__" etc, where __\[FOLDER\]__ stands for containing folder's name

:hammer_and_wrench: - _and_ user specifies which files should be referenced in given indexes. Currently there're three options: 
  a) all files in the same folder 
  b) all files in the folder _and_ all files in subfolders 
  c) all files in the folder _and_ files in subfolders but only if those subfolders don't have their own indexes

:heavy_check_mark: - plugin checks if all index(MOC) files contain all links they should contain. Check-up could be triggered manually or performed every time a vault is opened

:memo: - plugin adds missing links either to the end (or start) of an index file, or to a dedicated file in the same folder, so they could be moved to their proper places in an index file. User can specify format for text of those links, like "__\*\*\* \[LINKS\] \*\*\*__" or "__\#ADDED_LINKS \[LINKS\]__", where "__\[LINKS\]__" is a plug for added links, one on each line for easy copy-pasting

:crayon: - _and_ plugin marks files that had missing links in file explorer. Those marks persist until file is modified (for index files) or cleared of any links (for dedicated "missing links" file)

_Check out plugin settings page after you install it for details on all options_
___

## Make it better

You're most welcome to add PR for a new feature, bug fix or simply better solution.

OR make a feature request on thread at Obsidian community forum that I will create as soon as plugin is approved. Yes, I'm willing to expand functionality based on popular requests asap :)
___

## Licence

MIT
